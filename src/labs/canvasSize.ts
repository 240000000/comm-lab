/**
 * 画布位图尺寸只在真变化时才重设。
 *
 * canvas.width / canvas.height 一旦赋值，浏览器就重分配位图并清屏，
 * 哪怕赋的是同一个数。图表每帧都调一次，位图就被每帧重分配一次。
 * 这里记住上一次的位图宽高与 dpr，一样就跳过，只有窗口缩放、dpr 变化
 * 或宽度真的变了才重设。
 */
const sizes = new WeakMap<HTMLCanvasElement, { width: number; height: number; dpr: number }>()

export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
): boolean {
  const next = {
    width: Math.round(width * dpr),
    height: Math.round(height * dpr),
    dpr,
  }
  const previous = sizes.get(canvas)
  if (
    previous !== undefined &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.dpr === next.dpr
  ) {
    return false
  }
  canvas.width = next.width
  canvas.height = next.height
  sizes.set(canvas, next)
  return true
}