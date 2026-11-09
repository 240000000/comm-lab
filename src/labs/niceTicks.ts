/**
 * 线性轴的「好看步长」网格：候选步长是 1、2、2.5、5 乘 10 的整数次幂，
 * 取范围内能落下 3～9 根、且最接近 5 根的那个。刻度全是步长的整数倍，
 * 所以只要 0 落在范围内，0 就一定自己占一格（对称轴不再把 0 夹在两根刻度中间）。
 */
export function niceTicks(min: number, max: number): number[] {
  const span = max - min
  if (!Number.isFinite(span) || span <= 0) return [min]
  const baseExp = Math.floor(Math.log10(span / 5))
  let best: { ticks: number[]; score: number; step: number } | null = null
  for (let exp = baseExp - 1; exp <= baseExp + 1; exp += 1) {
    for (const mult of [1, 2, 2.5, 5]) {
      const step = mult * Math.pow(10, exp)
      const ticks: number[] = []
      for (let k = Math.ceil(min / step - 1e-9); k <= Math.floor(max / step + 1e-9); k += 1) {
        const value = k * step
        ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)))
      }
      if (ticks.length < 2) continue
      const score = Math.abs(ticks.length - 5)
      if (!best || score < best.score || (score === best.score && step < best.step)) {
        best = { ticks, score, step }
      }
    }
  }
  return best ? best.ticks : [min, max]
}
