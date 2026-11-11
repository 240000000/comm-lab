// 首页粒子云的形态循环：12 秒一轮，眼图停 4.5 秒、变形 1.5 秒、频谱停 4.5 秒、
// 再变形 1.5 秒变回来。
//
// 这里只算「现在该在哪两个形态之间、走到几成」，不碰 DOM、不碰点云，
// 画布那边拿 formAt() 的返回值逐帧在两组点上插值。进度用 smoothstep
// （3t²−2t³）而不是线性：两端导数归零，起止时不会像被猛地拽一下。
//
// node --test 可以直接加载本模块。

export type ParticleForm = 'eye' | 'spectrum'

/** 一整轮：0–4.5 停 A，4.5–6 变 B，6–10.5 停 B，10.5–12 变回 A。 */
export const FORM_PERIOD = 12000
/** 停在形态 A 的时长。 */
export const FORM_HOLD_A = 4500
/** 一次变形的时长（A→B 与 B→A 相同）。 */
export const FORM_MORPH = 1500
/** 形态 B 结束的时刻：6 秒开始停、到 10.5 秒为止。 */
export const FORM_HOLD_B_END = FORM_HOLD_A + FORM_MORPH + 4500

export type FormState = {
  /** 从哪个形态出发。 */
  from: ParticleForm
  /** 插值的目标形态。 */
  to: ParticleForm
  /** 已经走了几成，0…1；停住时恒为 0。 */
  t: number
}

/** 平滑插值曲线 3t²−2t³，输入输出都夹在 0…1。 */
export function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/** 第 elapsedMs 毫秒时的形态循环状态。负时间按同一轮往回数。 */
export function formAt(elapsedMs: number): FormState {
  const span = FORM_PERIOD - FORM_HOLD_B_END
  const cycle = ((elapsedMs % FORM_PERIOD) + FORM_PERIOD) % FORM_PERIOD
  if (cycle < FORM_HOLD_A) return { from: 'eye', to: 'eye', t: 0 }
  if (cycle < FORM_HOLD_A + FORM_MORPH) {
    return { from: 'eye', to: 'spectrum', t: smoothstep((cycle - FORM_HOLD_A) / FORM_MORPH) }
  }
  if (cycle < FORM_HOLD_B_END) return { from: 'spectrum', to: 'spectrum', t: 0 }
  return { from: 'spectrum', to: 'eye', t: smoothstep((cycle - FORM_HOLD_B_END) / span) }
}
