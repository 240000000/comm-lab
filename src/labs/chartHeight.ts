// 课程视图的画布高度：跟着宽度走，但不是线性的——太窄时给个能看清的下限，
// 太宽时封顶，免得一屏里光图就占掉两屏。纯函数，不碰 DOM，方便单测。
export const CHART_HEIGHT_MIN = 320
export const CHART_HEIGHT_MAX = 520
export const CHART_HEIGHT_RATIO = 0.42

/** 宽度（CSS px）→ 画布高度（CSS px），夹在 320–520，按 0.42 的宽高比取整。 */
export function chartHeightFor(width: number): number {
  const raw = Math.round((Number.isFinite(width) ? width : 0) * CHART_HEIGHT_RATIO)
  return Math.min(CHART_HEIGHT_MAX, Math.max(CHART_HEIGHT_MIN, raw))
}