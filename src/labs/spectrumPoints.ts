// 首页那两团粒子的第二个形态：一叠三维频谱。
//
// 形态 A 是眼图瀑布（纵轴是叠加出来的幅度，横轴是时间相位），这里换成频域：
// 横轴是频率、纵向是幅度，一条谱线沿深度方向等距排开，摞起来像一块会转的谱面。
// 频谱用 sinc 型（主瓣在中心、两侧旁瓣依次衰减），再乘一个高斯窗把远处的
// 旁瓣压下去，免得整片糊在黑底上。
//
// 关键约束：这里的点与 eyePoints() 是「同一张网格」——同样是 trace × sample，
// 同样 100 列，x、z 的位置也与眼图那边一模一样，只有 y 换成频谱幅度。
// 只有这样，同一个下标 i 才在两个形态里都有定义，逐帧按下标插值才成立。
//
// 这里只有取点，没有 DOM、没有 canvas、没有时间——node --test 可以直接加载。

import { EYE_SAMPLES, EYE_SPAN, EYE_TRACES, type EyePoint } from './eyePoints.ts'

/** 谱线条数：与眼图的迹数一致（每团 30 条，共 60 条），下标才能一一对应。 */
export const SPECTRUM_TRACES = EYE_TRACES
export const SPECTRUM_SAMPLES = EYE_SAMPLES
/** 深度方向的总跨度，与眼图同一落程，变形时不会往画面外窜。 */
export const SPECTRUM_SPAN = EYE_SPAN
/** 横轴看到的频率范围是 ±SPECTRUM_BAND 个「谱零点间距」。 */
export const SPECTRUM_BAND = 3.6
/** 归一化峰值：与眼图中心列的 ±1.02 同一量级，B 不会比 A 高出一截。 */
export const SPECTRUM_PEAK = 1

/**
 * 归一化的 sinc 频谱幅度：主瓣在 0 处等于 1，零点在整数频率上，
 * 两侧旁瓣分别是 −0.212、+0.127、−0.091……逐级衰减。
 * 远处再乘一个高斯窗，把第三个旁瓣之后的残余压到看不见。
 */
export function spectrumAmplitude(freq: number): number {
  const main = Math.abs(freq) < 1e-9 ? 1 : Math.sin(Math.PI * freq) / (Math.PI * freq)
  const taper = Math.exp(-((freq / 3) ** 2))
  return SPECTRUM_PEAK * main * taper
}

/** 第 trace 条谱线（0…59）第 sample 列（0…99）落在三维里的哪个点。 */
export function spectrumPoint(trace: number, sample: number): EyePoint {
  const x = -1 + (2 * sample) / (SPECTRUM_SAMPLES - 1)
  return {
    x,
    y: spectrumAmplitude(x * SPECTRUM_BAND),
    z: (trace / (SPECTRUM_TRACES - 1) - 0.5) * SPECTRUM_SPAN,
  }
}

/** 总共多少个点（= 谱线条数 × 列数，与 eyePointCount() 相等）。 */
export function spectrumPointCount(): number {
  return SPECTRUM_TRACES * SPECTRUM_SAMPLES
}

/** 一次算好全部点：[x, y, z, x, y, z, …]，与 eyePoints() 同序同长。 */
export function spectrumPoints(): Float32Array {
  const out = new Float32Array(spectrumPointCount() * 3)
  let at = 0
  for (let trace = 0; trace < SPECTRUM_TRACES; trace += 1) {
    const z = (trace / (SPECTRUM_TRACES - 1) - 0.5) * SPECTRUM_SPAN
    for (let sample = 0; sample < SPECTRUM_SAMPLES; sample += 1) {
      out[at] = -1 + (2 * sample) / (SPECTRUM_SAMPLES - 1)
      out[at + 1] = spectrumAmplitude(out[at] * SPECTRUM_BAND)
      out[at + 2] = z
      at += 3
    }
  }
  return out
}
