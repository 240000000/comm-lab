/**
 * 首页左下角那条三维曲线的取点。
 *
 * 这里只有数学：给「沿曲线走到哪」与「转过多少相位」，返回一个三维点。
 * 投影、描边、渐变全部留在 HomeCurve.tsx 里——这个文件能被 node --test 直接加载。
 *
 * 形状是一条闭曲线：绕竖轴转一圈的同时上下起伏两次，半径按三次谐波鼓起三瓣。
 * 与右上角那团会散开又收回的星座点云形成对照：那边是离散的点，这边是连续的一根线。
 */

export type CurvePoint = { x: number; y: number; z: number }

const TAU = Math.PI * 2

/** 一圈采样多少个点。220 个在 300 px 宽的画布上看不出折线。 */
export const CURVE_SAMPLES = 220

/** 半径只跟沿曲线的参数有关，**与相位无关**——相位转动的只是角度。 */
export function curveRadius(u: number): number {
  return 1 + 0.42 * Math.cos(u * TAU * 3)
}

/** 沿一圈的上下起伏，同样只跟参数有关。 */
export function curveHeight(u: number): number {
  return Math.sin(u * TAU * 2) * 0.55
}

/**
 * 曲线上的一点。
 *
 * u 是沿一圈的参数（0 与 1 是同一个点），phase 是整条曲线绕竖轴转过的角度。
 * 因为半径与起伏都只依赖 u，相位只进入 cos/sin 的角度里，
 * 所以同一个 u 上换相位，点的模长一点不变，变的只是它转到了哪一侧。
 */
export function homeCurvePoint(u: number, phase: number): CurvePoint {
  const turn = u * TAU + phase
  const radius = curveRadius(u)
  return {
    x: radius * Math.cos(turn),
    y: curveHeight(u),
    z: radius * Math.sin(turn),
  }
}

/** 一整圈的点（首尾各一个，方便直接连成闭合折线）。 */
export function homeCurvePoints(phase: number, samples = CURVE_SAMPLES): CurvePoint[] {
  const points: CurvePoint[] = []
  for (let i = 0; i <= samples; i++) points.push(homeCurvePoint(i / samples, phase))
  return points
}

/** 时间（毫秒）换算成相位：默认一圈 9 秒，慢到不抢注意力。 */
export function phaseAt(elapsedMs: number, periodMs = 9000): number {
  return (elapsedMs / periodMs) * TAU
}

/** 一点在三维里的模长，测试与描边都用它。 */
export function pointLength(point: CurvePoint): number {
  return Math.hypot(point.x, point.y, point.z)
}
