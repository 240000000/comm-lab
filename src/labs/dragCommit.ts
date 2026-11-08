/**
 * 拖动期间的提交节流。
 *
 * 为什么要有这个东西：课程视图每改一个参数就要把整章重算一遍（第 6 章一次
 * 十几毫秒），而 rAF 合帧只保证「一帧最多一次」，鼠标一路拖过去仍然是帧帧都算。
 * 这里的做法是拖动中隔一次提交一次（每两帧算一次），松手时不管隔了几次，都用
 * 最后一次的完整参数再提交一遍——所以松手之后的读数、结论、失效判据跟一次都
 * 没省过的路径完全一样，被省掉的只有中间帧。
 *
 * 状态放在闭包里而不是组件 state 里：拖动中的每一帧都要读它，走 state 会多一次
 * 渲染，节流本身反而更贵。
 */
export type DragCoalescer<T> = {
  /** 按下滑块：从这里开始隔一次提交一次 */
  begin: () => void
  /** 每次参数变化都调；不在拖动中就直接提交 */
  push: (value: T, commit: (value: T) => void) => void
  /** 松手：立刻用最后一次的值全精度提交一遍 */
  end: (commit: (value: T) => void) => void
  /** 最后一次推入的值（没推过就是 null） */
  live: () => T | null
  /** 当前是否处在拖动中 */
  dragging: () => boolean
}

export function createDragCoalescer<T>(): DragCoalescer<T> {
  let live: T | null = null
  let active = false
  let skip = false

  return {
    begin() {
      active = true
      skip = false
    },
    push(value, commit) {
      live = value
      if (!active) {
        commit(value)
        return
      }
      // 先算一帧、再跳过一帧：按下之后的第一个变化要立刻有反馈，
      // 而不是先空一拍。
      if (skip) {
        skip = false
        return
      }
      skip = true
      commit(value)
    },
    end(commit) {
      active = false
      skip = false
      if (live !== null) commit(live)
    },
    live: () => live,
    dragging: () => active,
  }
}
