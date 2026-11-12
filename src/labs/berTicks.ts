/**
 * BER 图的横轴刻度（线性 dB 轴）。
 *
 * 原来刻度是从数据点上按「(snr − from) % 4 === 0」挑的——步长一换（0.5 或
 * 0.25 dB）就一根都挑不出来。这里改走 niceTicks：刻度与采样步长解耦，
 * 只保留落在范围内的那几根。
 */
import { niceTicks } from './niceTicks.ts'

export function berTicks(fromDb: number, toDb: number): number[] {
  const lo = Math.min(fromDb, toDb)
  const hi = Math.max(fromDb, toDb)
  return niceTicks(lo, hi).filter((tick) => tick >= lo - 1e-9 && tick <= hi + 1e-9)
}
