/**
 * 首页左下角那条三维螺旋线的取点。
 *
 * 这里只有数学：给「沿螺旋走到哪」与「转过多少相位」，返回一个三维点。
 * 投影、描边、外发光全部留在 HomeCurve.tsx 里——这个文件能被 node --test 直接加载。
 *
 * 形状是一条绕竖轴的等半径螺旋：转一圈往下落一截，每圈落得一样多。
 * 与右上角那团会散开又收回的星座点云形成对照：那边是离散的点，这边是连续的一根线。
 */

export type CurvePoint = { x: number; y: number; z: number }

const TAU = Math.PI * 2

/** 整条螺旋绕竖轴转多少圈。圈数越多，竖条带填得越满。 */
export const SPIRAL_TURNS = 7

/** 螺旋半径——**在整个参数区间里恒为这个数**，这是螺旋与三瓣曲线的根本区别。 */
export const SPIRAL_RADIUS = 1

/** 从上到下总共落多少；每圈落 SPIRAL_SPAN / SPIRAL_TURNS，是个常数。 */
export const SPIRAL_SPAN = 1.4

/** 整条螺旋采样多少个点。900 个在 300×520 的条带上看不出折线。 */
export const CURVE_SAMPLES = 900

/** 半径与参数、相位都无关：螺旋处处等半径。 */
export function curveRadius(_u: number): number {
  return SPIRAL_RADIUS
}

/** 沿螺旋往下的高度：从 +SPAN/2 匀速落到 −SPAN/2，与相位无关。 */
export function curveHeight(u: number): number {
  return (0.5 - u) * SPIRAL_SPAN
}

/**
 * 螺旋线上的一点。
 *
 * u 是沿整条螺旋的参数（0 在顶、1 在底），phase 是整条螺旋绕竖轴转过的角度。
 * 半径恒定、高度只依赖 u，所以同一个 u 上换相位，点到竖轴的距离一点不变，
 * 变的只是它转到了哪一侧。
 */
export function homeCurvePoint(u: number, phase: number): CurvePoint {
  const turn = u * TAU * SPIRAL_TURNS + phase
  return {
    x: SPIRAL_RADIUS * Math.cos(turn),
    y: curveHeight(u),
    z: SPIRAL_RADIUS * Math.sin(turn),
  }
}

/** 整条螺旋的点（首尾各一个，方便直接连成折线）。 */
export function homeCurvePoints(phase: number, samples = CURVE_SAMPLES): CurvePoint[] {
  const points: CurvePoint[] = []
  for (let i = 0; i <= samples; i++) points.push(homeCurvePoint(i / samples, phase))
  return points
}

/** 时间（毫秒）换算成相位：默认一圈 9 秒，慢到不抢注意力。 */
export function phaseAt(elapsedMs: number, periodMs = 9000): number {
  return (elapsedMs / periodMs) * TAU
}

/** 一点到竖轴的距离——螺旋上它处处相等，描边靠它判断远近。 */
export function pointLength(point: CurvePoint): number {
  return Math.hypot(point.x, point.z)
}
