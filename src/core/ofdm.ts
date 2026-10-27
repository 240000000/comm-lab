/**
 * 两径 OFDM 链路：发端做 QPSK + IFFT + 加循环前缀，信道是一主一延时的两条径，
 * 收端切窗、去 CP、FFT、按象限判决。
 *
 * 这一页只演示一件事：循环前缀把多径的「拖尾」关进 CP 里，只要延时不超过 CP 长度，
 * 数据段就是干净的；一旦超过，拖尾压进数据段，码间干扰（ISI）就开始出错。
 *
 * 约定（写在页面上，免得数字被误读）：
 * - 链路里没有噪声。所有误码都来自码间干扰，不是热噪声。
 * - 用复基带算：时域采样是复数，IFFT/FFT 前后不用再补共轭对称。
 *   时域图上画的是实部，这一点页面上会注明。
 * - 延时径幅度固定 0.5（功率是主径的 1/4），频域上是有起伏的衰落，
 *   不会出现两径完全抵消的零点——那种零点只在两径等幅时才出现。
 * - 64 个子载波全部用上，没有空子载波、没有保护带。
 * - 频域图和 EVM 都是「按子载波各自归一」之后的结果：每个子载波那 64 个点
 *   先除掉它自己的复增益（相当于事后知道每条子载波的固定衰落），
 *   剩下的偏移才是码间干扰。QPSK 的判决本身不看幅度，所以这一步只影响显示，
 *   不影响误符号率。
 */
import { dft, idft, type Complex } from './dft.ts'
import { createRng } from './rng.ts'

/** 子载波数，同时是一个 OFDM 符号的数据采样数。 */
export const SUBCARRIERS = 64
/** 延时径的幅度（相对主径）。0.5 功率，不制造零点。 */
export const ECHO_AMPLITUDE = 0.5
/** CP 允许的最大长度（采样），页面上滑块用同一上限。 */
export const MAX_CP = 24
/** 延时径允许的最大延时（采样）。 */
export const MAX_DELAY = 40

/** QPSK 四点：下标 0/1/2/3 对应 I、Q 的符号组合（I 负 = 1，Q 负 = 2）。 */
export const QPSK: Complex[] = [
  { re: 1, im: 1 },
  { re: -1, im: 1 },
  { re: 1, im: -1 },
  { re: -1, im: -1 },
]

/** 把接收点按象限判成 QPSK 下标。幅度信息在判决这一步被扔掉，这是 QPSK 的硬判决。 */
export function decideQpsk(point: Complex): number {
  return (point.re < 0 ? 1 : 0) + (point.im < 0 ? 2 : 0)
}

export type LinkStats = {
  /** 判错的 QPSK 符号个数。 */
  symbolErrors: number
  /** 一共比对了多少个 QPSK 符号（符号数 × 子载波数）。 */
  symbolCount: number
  /** 误符号率。 */
  ser: number
  /** 误差向量幅度，百分比。按子载波各自归一后计算，只剩码间干扰。 */
  evmPercent: number
  /** 最后一个 OFDM 符号解出来的 64 个接收点（每个点已除掉自己子载波的复增益）。 */
  constellation: Complex[]
}

export type WaveformView = {
  cpLen: number
  delay: number
  /** 发端这一窗的输入样本（实部）。含 CP，长度 = 64 + cpLen。 */
  dry: number[]
  /** 延时径落进这一窗的分量（实部）。n < delay 的那几位来自上一个符号的尾巴。 */
  echo: number[]
  /** 两者相加 = 收端实际看到的波形（实部）。 */
  received: number[]
  /** 有多少个数据区采样被上一个符号的拖尾压到（0 表示完全干净）。 */
  intrudingSamples: number
}

export type OfdmResult = {
  withCp: LinkStats
  noCp: LinkStats
  wave: WaveformView
  seedUsed: number
  echoAmplitude: number
}

export type OfdmParams = {
  cpLen: number
  delay: number
  symbolCount: number
  seed: number
}

function assertParams({ cpLen, delay, symbolCount }: OfdmParams): void {
  if (!Number.isInteger(cpLen) || cpLen < 0 || cpLen > MAX_CP) {
    throw new RangeError(`CP 长度必须是 0..${MAX_CP} 的整数，收到 ${cpLen}`)
  }
  if (!Number.isInteger(delay) || delay < 0 || delay > MAX_DELAY) {
    throw new RangeError(`延时必须是 0..${MAX_DELAY} 的整数，收到 ${delay}`)
  }
  if (!Number.isInteger(symbolCount) || symbolCount < 1) {
    throw new RangeError(`符号数必须是正整数，收到 ${symbolCount}`)
  }
}

/** 按 QPSK 下标生成频域数据，再 IFFT 成时域一个符号（复数）。 */
function modulate(indices: Uint8Array): Complex[] {
  const freq: Complex[] = new Array(SUBCARRIERS)
  for (let k = 0; k < SUBCARRIERS; k++) {
    const p = QPSK[indices[k]]
    freq[k] = { re: p.re, im: p.im }
  }
  return idft(freq)
}

/** 两径信道（复数）：y[m] = x[m] + amp·x[m-delay]，下标越界按 0 处理。 */
function channel(xre: Float64Array, xim: Float64Array, amp: number, delay: number) {
  const n = xre.length
  const yre = new Float64Array(n)
  const yim = new Float64Array(n)
  for (let m = 0; m < n; m++) {
    yre[m] = xre[m]
    yim[m] = xim[m]
    if (m - delay >= 0) {
      yre[m] += amp * xre[m - delay]
      yim[m] += amp * xim[m - delay]
    }
  }
  return { re: yre, im: yim }
}

type LinkSample = { received: Complex[]; ideal: Complex[] }

/**
 * 按子载波归一并算 EVM：每个子载波用自己那串点拟合一个复增益，
 * 消掉固定衰落后再看残差，剩下的就是码间干扰。
 */
function summarize(samples: LinkSample[], errors: number, lastSpectrum: Complex[]): LinkStats {
  const total = samples.length
  let errorEnergy = 0
  let referenceEnergy = 0
  const gains: Complex[] = new Array(SUBCARRIERS)

  for (let k = 0; k < SUBCARRIERS; k++) {
    let numRe = 0
    let numIm = 0
    let den = 0
    for (let s = 0; s < total; s++) {
      const r = samples[s].received[k]
      const t = samples[s].ideal[k]
      numRe += r.re * t.re + r.im * t.im
      numIm += r.im * t.re - r.re * t.im
      den += t.re * t.re + t.im * t.im
    }
    gains[k] = { re: numRe / den, im: numIm / den }

    for (let s = 0; s < total; s++) {
      const r = samples[s].received[k]
      const t = samples[s].ideal[k]
      const g = gains[k]
      const refRe = g.re * t.re - g.im * t.im
      const refIm = g.re * t.im + g.im * t.re
      const dr = r.re - refRe
      const di = r.im - refIm
      errorEnergy += dr * dr + di * di
      referenceEnergy += refRe * refRe + refIm * refIm
    }
  }

  const constellation: Complex[] = new Array(SUBCARRIERS)
  for (let k = 0; k < SUBCARRIERS; k++) {
    const g = gains[k]
    const mag = g.re * g.re + g.im * g.im || 1
    constellation[k] = {
      re: (lastSpectrum[k].re * g.re + lastSpectrum[k].im * g.im) / mag,
      im: (lastSpectrum[k].im * g.re - lastSpectrum[k].re * g.im) / mag,
    }
  }

  const symbolCount = total * SUBCARRIERS

  return {
    symbolErrors: errors,
    symbolCount,
    ser: errors / symbolCount,
    evmPercent: referenceEnergy > 0 ? Math.sqrt(errorEnergy / referenceEnergy) * 100 : 0,
    constellation,
  }
}

/**
 * 跑一次完整链路：同一批 QPSK 数据分别走「有 CP」和「无 CP」两条支路。
 * 两条支路的数据、信道完全一样，只有「有没有 CP」这一个变量不同。
 */
export function runOfdm(params: OfdmParams): OfdmResult {
  assertParams(params)
  const { cpLen, delay, symbolCount, seed } = params
  const amp = ECHO_AMPLITUDE
  const rng = createRng(seed)

  // 1. 数据：每个符号 64 个 QPSK 下标，两条支路共用。
  const data = new Uint8Array(symbolCount * SUBCARRIERS)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rng.next() * 4)

  // 2. 两个发端流（复基带）：有 CP 的每符号 64+cpLen 个采样，无 CP 的每符号 64 个。
  const withBlock = SUBCARRIERS + cpLen
  const txWith = {
    re: new Float64Array(withBlock * symbolCount),
    im: new Float64Array(withBlock * symbolCount),
  }
  const txNo = {
    re: new Float64Array(SUBCARRIERS * symbolCount),
    im: new Float64Array(SUBCARRIERS * symbolCount),
  }

  for (let s = 0; s < symbolCount; s++) {
    const block = data.subarray(s * SUBCARRIERS, (s + 1) * SUBCARRIERS)
    const x = modulate(block)
    const startWith = s * withBlock
    for (let n = 0; n < SUBCARRIERS; n++) {
      txNo.re[s * SUBCARRIERS + n] = x[n].re
      txNo.im[s * SUBCARRIERS + n] = x[n].im
      txWith.re[startWith + cpLen + n] = x[n].re
      txWith.im[startWith + cpLen + n] = x[n].im
    }
    // 把数据段末尾 cpLen 个采样原样复制成前缀（复数照抄，不做任何处理）
    for (let n = 0; n < cpLen; n++) {
      txWith.re[startWith + n] = x[SUBCARRIERS - cpLen + n].re
      txWith.im[startWith + n] = x[SUBCARRIERS - cpLen + n].im
    }
  }

  // 3. 同一个两径信道，分别作用在两个流上。
  const rxWith = channel(txWith.re, txWith.im, amp, delay)
  const rxNo = channel(txNo.re, txNo.im, amp, delay)

  // 4. 收端：切窗 → FFT → 判决。有 CP 时丢掉前缀，无 CP 时直接切数据段。
  const receive = (re: Float64Array, im: Float64Array, blockLen: number, hasCp: boolean) => {
    const samples: LinkSample[] = new Array(symbolCount)
    let errors = 0
    let lastSpectrum: Complex[] = new Array(SUBCARRIERS)

    for (let s = 0; s < symbolCount; s++) {
      const block = data.subarray(s * SUBCARRIERS, (s + 1) * SUBCARRIERS)
      const start = s * blockLen + (hasCp ? cpLen : 0)
      const time: Complex[] = new Array(SUBCARRIERS)
      for (let n = 0; n < SUBCARRIERS; n++) time[n] = { re: re[start + n], im: im[start + n] }
      const spectrum = dft(time)
      lastSpectrum = spectrum

      const ideal: Complex[] = new Array(SUBCARRIERS)
      for (let k = 0; k < SUBCARRIERS; k++) {
        ideal[k] = { ...QPSK[block[k]] }
        if (decideQpsk(spectrum[k]) !== block[k]) errors++
      }
      samples[s] = { received: spectrum, ideal }
    }

    return summarize(samples, errors, lastSpectrum)
  }

  const withCp = receive(rxWith.re, rxWith.im, withBlock, true)
  const noCp = receive(rxNo.re, rxNo.im, SUBCARRIERS, false)

  // 5. 时域波形：取第 1 个符号（不是第 0 个，这样它的窗口里能看到上一个符号的尾巴）。
  const viewSymbol = symbolCount > 1 ? 1 : 0
  const start = viewSymbol * withBlock
  const dry: number[] = new Array(withBlock)
  const echo: number[] = new Array(withBlock)
  const received: number[] = new Array(withBlock)
  for (let n = 0; n < withBlock; n++) {
    const m = start + n
    dry[n] = txWith.re[m]
    const src = m - delay
    echo[n] = src >= 0 ? amp * txWith.re[src] : 0
    received[n] = rxWith.re[m]
  }
  const intrudingSamples = Math.max(0, Math.min(delay, withBlock) - cpLen)

  return {
    withCp,
    noCp,
    wave: { cpLen, delay, dry, echo, received, intrudingSamples },
    seedUsed: seed,
    echoAmplitude: amp,
  }
}
