/**
 * BER–SNR 曲线：把 0–20 dB 扫一遍。
 *
 * 每个信噪比点独立跑一次统计（各自派生种子），所以整条曲线是
 * 「同一种子 + 同一批参数」下完全可复现的。理论上扫描 21 个点 × 20,000 符号
 * 在本机是几十毫秒的量级；如果哪天换到很慢的机器上超过两秒，
 * 降 symbolCount 并把实际用的数字写到界面上，而不是让用户干等。
 */
import { theoryBer } from './ber.ts'
import { simulateAwgn } from './metrics.ts'

export type CurvePoint = {
  /** 这个点对应的每符号信噪比（dB）。 */
  snrDb: number
  /** 实测误比特率 = bitErrors / bitCount；0 表示这批样本里一个比特都没错。 */
  ber: number
  /** 实测错了多少比特（分母的分子，界面上要能写出来）。 */
  bitErrors: number
  /** 这个点比对了多少比特（分母）。 */
  bitCount: number
  /** 同样信噪比下的理论值，画虚线用。 */
  theory: number
}

/**
 * 扫描一段信噪比。
 *
 * 结果按 snrDb 升序返回，长度由 from/to/step 决定。
 * `stepDb` 必须为正，否则 RangeError——负数步长会让循环一次都不跑，
 * 界面拿到空数组只会显示「没有数据」，查起来很费劲。
 */
export function sweepBer(options: {
  order: number
  fromDb: number
  toDb: number
  stepDb: number
  symbolCount: number
  seed: number
}): CurvePoint[] {
  const { order, fromDb, toDb, stepDb, symbolCount, seed } = options
  if (!(stepDb > 0)) {
    throw new RangeError(`步长必须是正数：${stepDb}`)
  }
  if (!(toDb >= fromDb)) {
    throw new RangeError(`终止信噪比不能小于起始值：${fromDb} → ${toDb}`)
  }

  const result: CurvePoint[] = []
  const steps = Math.round((toDb - fromDb) / stepDb)
  for (let k = 0; k <= steps; k += 1) {
    const snrDb = Number((fromDb + k * stepDb).toFixed(6))
    const stats = simulateAwgn({ order, snrDb, symbolCount, seed, keepSamples: false })
    result.push({
      snrDb,
      ber: stats.ber,
      bitErrors: stats.bitErrors,
      bitCount: stats.bitCount,
      theory: theoryBer(order, snrDb),
    })
  }
  return result
}
