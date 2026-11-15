/**
 * 全站动效常数（R135）。
 *
 * 三档时长只覆盖三种动作，别的一概不许自己造：
 * - press：按下/松开这类「手上的反馈」，要快到像没过渡；
 * - swap：同屏内容替换（切章、切档、悬停光效），看得见但不拖；
 * - enter：整块内容进场（路由切换、首屏卡片错峰），再长就开始等它。
 *
 * 缓动只有一条 cubic-bezier(.2,0,0,1)：起步快、收尾稳，
 * 比 ease 干净，也不会像 ease-out 那样在末尾「滑一下」。
 *
 * CSS 侧不要写死数字，一律用 applyMotionTokens() 写进 :root 的四个变量，
 * 这样 TS 与 CSS 永远是同一份数值；测试与截图脚本也直接读这两个常量。
 */
export const MOTION_PRESS_MS = 90
export const MOTION_SWAP_MS = 160
export const MOTION_ENTER_MS = 220

/** 全站唯一缓动。 */
export const MOTION_EASE = 'cubic-bezier(.2,0,0,1)'

/** 卡片错峰间隔：四张卡依次进场，每张晚 40ms。 */
export const MOTION_STAGGER_MS = 40

const TOKENS: Array<[string, string]> = [
  ['--motion-press', `${MOTION_PRESS_MS}ms`],
  ['--motion-swap', `${MOTION_SWAP_MS}ms`],
  ['--motion-enter', `${MOTION_ENTER_MS}ms`],
  ['--motion-ease', MOTION_EASE],
  ['--motion-stagger', `${MOTION_STAGGER_MS}ms`],
]

/** 把上面这份数值写进根元素（幂等，重复调用无害）。 */
export function applyMotionTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of TOKENS) root.style.setProperty(name, value)
}