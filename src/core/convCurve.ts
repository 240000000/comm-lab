/**
 * 卷积码三条线：不编码、硬判决译码、软判决译码。
 *
 * 三条线必须用同一批信噪比、同一套随机种子来源，否则没法横向比。
 * 每条线各自一条随机流（由种子和信噪比共同派生），互不干扰，重跑一次数字完全一样。
 *
 * 噪声口径要写清楚，否则三条线没法同轴对比：
 * - 横轴是 Eb/N0（每信息比特的能量与噪声功率谱密度之比）。
 * - 编码把码率降到 1/2，同样的 Eb/N0 下，每个码符号只有一半能量，
 *   所以 Es/N0 = Eb/N0 + 10·log10(1/2) = Eb/N0 − 3.01 dB。
 * - 不编码那条线的码率是 1，Es/N0 就等于 Eb/N0。
 * 于是编码线是在「每个符号更吃亏」的条件下打的，赢了才是真赢。
 */
import { createRng } from './rng.ts'
import { qFunction } from './ber.ts'
import { deriveSeed } from './metrics.ts'
import {
  decodeHard,
  decodeSoft,
  encodeConvolutional,
  sliceHard,
  transmit,
} from './conv.ts'
import type { Rng } from './rng.ts'

export type ConvCurvePoint = {
  /** 横轴：Eb/N0，单位 dB。 */
  ebN0: number
  /** 这一点的 BER 与出错的比特数。 */
  uncoded: number
  uncodedErrors: number
  hard: number
  hardErrors: number
  soft: number
  softErrors: number
  /** 每点发了多少个信息比特，用来标「分母」。 */
  bits: number
  /** 不编码 BPSK 的理论误码率，画虚线用。 */
  theory: number
}

export type ConvSweepOptions = {
  fromDb: number
  toDb: number
  stepDb: number
  /** 每个信噪比点发多少个信息比特。 */
  bits: number
  seed: number
}

/** BPSK 的 Es/N0 → 噪声标准差（单路方差，Es = 1）。 */
const sigmaFor = (esN0Db: number): number => Math.sqrt(1 / (2 * Math.pow(10, esN0Db / 10)))

const randomBits = (count: number, rng: Rng): number[] => {
  const bits: number[] = []
  for (let i = 0; i < count; i += 1) bits.push(rng.next() > 0.5 ? 1 : 0)
  return bits
}

const countErrors = (sent: number[], got: number[]): number => {
  let errors = 0
  for (let i = 0; i < sent.length; i += 1) {
    if (sent[i] !== got[i]) errors += 1
  }
  return errors
}

export function sweepConv(options: ConvSweepOptions): ConvCurvePoint[] {
  const { fromDb, toDb, stepDb, bits, seed } = options
  if (!Number.isFinite(stepDb) || stepDb <= 0) {
    throw new RangeError(`扫描步长必须是正数，收到 ${stepDb}`)
  }
  if (!Number.isFinite(fromDb) || !Number.isFinite(toDb) || toDb < fromDb) {
    throw new RangeError(`扫描区间不合法：${fromDb} dB 到 ${toDb} dB`)
  }
  if (!Number.isInteger(bits) || bits <= 0) {
    throw new RangeError(`每点比特数必须是正整数，收到 ${bits}`)
  }

  const points: ConvCurvePoint[] = []
  const count = Math.round((toDb - fromDb) / stepDb)
  for (let index = 0; index <= count; index += 1) {
    const ebN0 = Number((fromDb + index * stepDb).toFixed(6))

    // 三条线各用一条独立随机流，种子都由「种子 + 信噪比」派生。
    const uncodedRng = createRng(deriveSeed(seed, ebN0))
    const hardRng = createRng(deriveSeed(seed + 1, ebN0))
    const softRng = createRng(deriveSeed(seed + 2, ebN0))

    // 一、不编码：直接 BPSK，切比特，比对。
    const uncodedBits = randomBits(bits, uncodedRng)
    const uncodedSigma = sigmaFor(ebN0)
    const uncodedReceived = uncodedBits.map((bit) =>
      (bit === 0 ? -1 : 1) + uncodedSigma * uncodedRng.gauss(),
    )
    const uncodedDecoded = uncodedReceived.map(sliceHard)
    const uncodedErrors = countErrors(uncodedBits, uncodedDecoded)

    // 二、编码 + 硬判决译码。
    const hardBits = randomBits(bits, hardRng)
    const hardCoded = encodeConvolutional(hardBits)
    const esN0 = ebN0 + 10 * Math.log10(0.5)
    const codedSigma = sigmaFor(esN0)
    const hardReceived = transmit(hardCoded.coded, codedSigma, hardRng)
    const hardDecoded = decodeHard(hardReceived.map(sliceHard))
    const hardErrors = countErrors(hardBits, hardDecoded.slice(0, bits))

    // 三、同一套发射流程，只是译码器不切比特。
    const softBits = randomBits(bits, softRng)
    const softCoded = encodeConvolutional(softBits)
    const softReceived = transmit(softCoded.coded, codedSigma, softRng)
    const softDecoded = decodeSoft(softReceived)
    const softErrors = countErrors(softBits, softDecoded.slice(0, bits))

    points.push({
      ebN0,
      uncoded: uncodedErrors / bits,
      uncodedErrors,
      hard: hardErrors / bits,
      hardErrors,
      soft: softErrors / bits,
      softErrors,
      bits,
      // 不编码 BPSK 的闭式解：Q(√(2Eb/N0))。
      theory: qFunction(Math.sqrt(2 * Math.pow(10, ebN0 / 10))),
    })
  }
  return points
}
