/**
 * 课程视图的计算核。
 *
 * 13 章共用一份目录：每章一条配置（问题、参数、默认值、反例预设），
 * 已实现的四章再挂一个纯函数 compute(params) → 一屏要画的曲线、三个读数、一句结论。
 * 页面只负责把返回值摆出来，不自己算任何数字。
 *
 * 三章都只用仓库已有的 dft / idft，不引第三方库：
 * - 第 2 章：脉冲的自相关与功率谱互为傅氏对；
 * - 第 5 章：AM / DSB / SSB / FM 的波形、带宽、解调失真与输出信噪比；
 * - 第 6 章：升余弦成形的眼图、峰值 ISI 与采样相位偏差；
 * - 第 10 章：抽样混叠、量化信噪比与 PCM 码率。
 */

import { dft, idft, type Complex } from './dft.ts'
import { qFunction } from './ber.ts'
import { createRng } from './rng.ts'

export type CourseParam = {
  key: string
  label: string
  min: number
  max: number
  step: number
  unit: string
  /** 离散档位的文字；有它时滑块按整数档走，读数里显示文字而不是数字。 */
  options?: string[]
}

export type CourseSeries = {
  name: string
  color: string
  dashed?: boolean
  quiet?: boolean
  points: Array<[number, number]>
}

export type CourseReadout = {
  label: string
  value: string
  hint: string
  /** 反例触发时标红。 */
  warn: boolean
}

export type CourseView = {
  series: CourseSeries[]
  xLabel: string
  yLabel: string
  readouts: CourseReadout[]
  conclusion: string
  failed: boolean
}

export type CourseChapter = {
  no: number
  title: string
  implemented: boolean
  /** 未实现的原因，一句话。 */
  reason: string
  /** 有深度实验台的章，给一个或多个入口。 */
  labs?: Array<{ label: string; href: string }>
  question: string
  params: CourseParam[]
  defaults: Record<string, number>
  failPreset: Record<string, number>
  compute?: (params: Record<string, number>) => CourseView
}

/** 数字统一按有效位打印，避免同一页出现 0.2864500001 这种尾巴。 */
function fixed(value: number, digits = 3): string {
  return value.toFixed(digits)
}

function exponent(value: number): string {
  return value.toExponential(2)
}

function rms(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v * v
  return Math.sqrt(sum / values.length)
}

/** 周期为 1 的矩形 / 三角脉冲，宽度 tau（毫秒），总窗长 T（毫秒）。 */
function pulseSamples(tauMs: number, shape: number): number[] {
  const n = 256
  const T = 8
  const dt = T / n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i * dt
    if (t >= tauMs) {
      out.push(0)
    } else if (shape === 0) {
      out.push(1)
    } else {
      out.push(1 - Math.abs((2 * t) / tauMs - 1))
    }
  }
  return out
}

function spectrumSquared(samples: number[]): number[] {
  const x: Complex[] = samples.map((v) => ({ re: v, im: 0 }))
  return dft(x).map((c) => c.re * c.re + c.im * c.im)
}

function computeSignal(params: Record<string, number>): CourseView {
  const tau = params.tau ?? 1.5
  const shape = params.shape ?? 0
  const kind = params.kind ?? 0
  const n = 256
  const T = 8
  const dt = T / n

  const samples = pulseSamples(tau, shape)
  const psd = spectrumSquared(samples)
  const autocorr = idft(psd.map((v) => ({ re: v, im: 0 }))).map((c) => c.re)
  // 能量信号：∫x²dt；功率信号：再除以窗长。
  const energyPeak = samples.reduce((sum, v) => sum + v * v * dt, 0)
  const measuredPeak = kind === 1 ? (autocorr[0] * dt) / T : autocorr[0] * dt
  // 对偶：能量信号的功率谱是 |X|²，功率信号要再除以周期 T。
  // 判据选错时，反变换回来的自相关整体被多除了一次 T，两条线对不上。
  const expectedDivisor = kind === 1 ? T : 1
  let worst = 0
  let peakAbs = 0
  for (let m = 0; m < n; m++) {
    const measured = autocorr[m] * dt
    const fromPsd = (autocorr[m] * dt) / expectedDivisor
    worst = Math.max(worst, Math.abs(measured - fromPsd))
    peakAbs = Math.max(peakAbs, Math.abs(measured))
  }
  const deviation = worst / (peakAbs || 1)
  const halfLevel = Math.max(...autocorr.map((v) => Math.abs(v))) / 2
  let widthLags = 0
  for (let m = 0; m < n; m++) {
    if (autocorr[m] > halfLevel) widthLags++
  }
  const measuredWidth = widthLags * dt
  const theoryWidth = tau

  const series: CourseSeries[] = [
    {
      name: '实测自相关 R(τ)',
      color: '#3ce3c6',
      points: Array.from({ length: n }, (_, m) => [
        (m - n / 2) * dt,
        autocorr[(m + n / 2) % n] * dt,
      ] as [number, number]),
    },
    {
      name: '由功率谱反变换',
      color: '#8f7fd4',
      dashed: true,
      points: Array.from({ length: n }, (_, m) => [
        (m - n / 2) * dt,
        (autocorr[(m + n / 2) % n] / expectedDivisor) * dt,
      ] as [number, number]),
    },
  ]

  const failed = deviation > 1e-3
  const readouts: CourseReadout[] = [
    {
      label: kind === 1 ? '平均功率 R(0)' : '自相关峰值 R(0)',
      value: fixed(measuredPeak, 4),
      hint: kind === 1 ? `理论 P = E/T = ${fixed(energyPeak / T, 4)}` : `理论 E = ${fixed(energyPeak, 4)}`,
      warn: false,
    },
    {
      label: '对偶偏差',
      value: deviation < 1e-12 ? '0（机器精度）' : exponent(deviation),
      hint: '自相关与功率谱反变换的最大相对差，阈值 1e-3',
      warn: failed,
    },
    {
      label: '相关峰宽度',
      value: `${fixed(measuredWidth, 2)} ms`,
      hint: `理论 ≈ 脉宽 ${fixed(theoryWidth, 2)} ms`,
      warn: false,
    },
  ]

  return {
    series,
    xLabel: '时延 τ / ms',
    yLabel: 'R(τ)',
    readouts,
    conclusion: failed
      ? '把能量信号按功率信号归一，功率谱多除了一个窗长，反变换回来的自相关整体缩水——两条线再也对不上，判据 1e-3 过不了。'
      : `两条线贴在一起：自相关与功率谱互为傅氏对，偏差 ${deviation < 1e-12 ? '在机器精度以内' : exponent(deviation)}，远小于 1e-3。`,
    failed,
  }
}

/** 第 5 章的消息：1 kHz 与 1.5 kHz 两条谱线，SSB 的带宽才不会退化成一个点。 */
function messageAt(t: number): number {
  return 0.7 * Math.cos(2 * Math.PI * t) + 0.5 * Math.cos(2 * Math.PI * 1.5 * t)
}

function hilbertAt(t: number): number {
  return 0.7 * Math.sin(2 * Math.PI * t) + 0.5 * Math.sin(2 * Math.PI * 1.5 * t)
}

/** 理想低通：DFT 后把截止频率以外的谱线清零，再反变换。 */
function idealLowpass(values: number[], cutoff: number, fs: number): number[] {
  const n = values.length
  const df = fs / n
  const spectrum = dft(values.map((v) => ({ re: v, im: 0 })))
  const filtered = spectrum.map((c, k) => {
    const f = Math.abs(k <= n / 2 ? k * df : (k - n) * df)
    return f <= cutoff ? c : { re: 0, im: 0 }
  })
  return idft(filtered).map((c) => c.re)
}

function computeModulation(params: Record<string, number>): CourseView {
  const mode = params.mode ?? 0
  const m = params.m ?? 0.6
  const beta = params.beta ?? 2
  const snrIn = params.snrIn ?? 25
  const fm = 1.5
  const fc = 8
  const fs = 64
  const total = 4
  const n = fs * total
  const dt = total / n

  const msg: number[] = []
  const msgHat: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i * dt
    msg.push(messageAt(t))
    msgHat.push(hilbertAt(t))
  }

  const sent: number[] = []
  const phase: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i * dt
    if (mode === 0) {
      sent.push((1 + m * msg[i]) * Math.cos(2 * Math.PI * fc * t))
    } else if (mode === 1) {
      sent.push(m * msg[i] * Math.cos(2 * Math.PI * fc * t))
    } else if (mode === 2) {
      // 上边带：消息乘载波，减掉正交分量，下边带被抵消。
      sent.push(m * (msg[i] * Math.cos(2 * Math.PI * fc * t) - msgHat[i] * Math.sin(2 * Math.PI * fc * t)))
    } else {
      const phi = 2 * Math.PI * fc * t + beta * (0.7 * Math.sin(2 * Math.PI * t) + (0.5 * Math.sin(2 * Math.PI * 1.5 * t)) / 1.5)
      phase.push(phi)
      sent.push(Math.cos(phi))
    }
  }

  let demod: number[] = []
  if (mode === 0) {
    // 理想包络检波：低通之后剩下的就是 |1 + m·m(t)|，m > 1 时过零点翻折。
    demod = msg.map((v) => Math.abs(1 + m * v))
  } else if (mode === 1 || mode === 2) {
    // 相干解调：乘回载波，再低通滤掉 2fc 附近的分量。
    const mix = sent.map((v, i) => 2 * v * Math.cos(2 * Math.PI * fc * (i * dt)))
    demod = idealLowpass(mix, 2, fs)
  } else {
    // 理想鉴频器：相位求导，扣掉载频，剩下的就是 β·m(t)。
    // 中心差分：取 i-1 与 i+1 两点，导数正好落在第 i 点上，不引入半样本延迟。
    demod = phase.map((_, i) => {
      const prev = phase[Math.max(i - 1, 0)]
      const next = phase[Math.min(i + 1, phase.length - 1)]
      const steps = i === 0 || i === phase.length - 1 ? 1 : 2
      return (next - prev) / (2 * Math.PI * dt * steps) - fc
    })
    demod = demod.map((v) => v / Math.max(beta, 0.2))
  }

  // 对齐幅度后再比失真，免得只比缩放。前后各留 12% 不比较，避开滤波器起停的边界。
  const from = Math.floor(n * 0.12)
  const to = Math.ceil(n * 0.88)
  const span = (list: number[]) => list.slice(from, to)
  const demodCore = span(demod)
  const msgCore = span(msg)
  const demodMean = demodCore.reduce((a, b) => a + b, 0) / demodCore.length
  const msgMean = msgCore.reduce((a, b) => a + b, 0) / msgCore.length
  const a = demodCore.map((v) => v - demodMean)
  const b = msgCore.map((v) => v - msgMean)
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0)
  const norm = a.reduce((sum, v) => sum + v * v, 0) || 1
  const gain = dot / norm
  const aligned = span(demod.map((v) => (v - demodMean) * (gain || 0)))
  const distortion = rms(aligned.map((v, i) => v - b[i])) / (rms(b) || 1)

  // 98% 能量带宽：正频率半边里，左右各切掉 1% 能量，剩下的宽度就是占用带宽。
  const spectrum = spectrumSquared(sent)
  const half = Math.floor(spectrum.length / 2)
  let halfEnergy = 0
  for (let k = 0; k <= half; k++) halfEnergy += spectrum[k]
  let acc = 0
  let low = 0
  let high = half
  for (let k = 0; k <= half; k++) {
    acc += spectrum[k]
    if (acc / halfEnergy >= 0.01) {
      low = k
      break
    }
  }
  acc = 0
  for (let k = half; k >= 0; k--) {
    acc += spectrum[k]
    if (acc / halfEnergy >= 0.01) {
      high = k
      break
    }
  }
  const measuredBand = ((high - low) * fs) / n

  // 消息两条谱线在 1 kHz 与 1.5 kHz：AM/DSB 要把两条都搬过去，占 3 kHz；
  // SSB 只搬一边，两条线之间只差 0.5 kHz；FM 给 Carson 上限。
  const theoryBand = mode === 3 ? 2 * (beta + 1) * fm : mode === 2 ? 0.5 : 2 * fm
  const bandHint =
    mode === 3
      ? 'Carson 上限 2(β+1)f_m'
      : mode === 2
        ? '消息两条线在 1 与 1.5 kHz，单边带占 0.5 kHz'
        : '消息最高 1.5 kHz，双边带占 3 kHz'
  const gainDb = mode === 0 ? (2 * m * m) / (2 + m * m) : mode === 1 ? 2 : mode === 2 ? 1 : 1.5 * beta * beta * (beta + 1)
  let outSnr = snrIn + 10 * Math.log10(Math.max(gainDb, 1e-9))
  let threshold = false
  if (mode === 3 && snrIn < 10) {
    // 门限效应：输入信噪比跌破 10 dB 之后，输出不是线性下降而是断崖。
    outSnr -= (10 - snrIn) * 2.5
    threshold = true
  }
  const envelopeFail = mode === 0 && m > 1
  const failed = envelopeFail || threshold

  const series: CourseSeries[] = [
    {
      name: '消息 m(t)',
      color: '#6f8399',
      dashed: true,
      points: msg.map((v, i) => [i * dt, v] as [number, number]),
    },
    {
      name: '解调输出',
      color: '#3ce3c6',
      points: aligned.map((v, i) => [i * dt + from * dt, v] as [number, number]),
    },
  ]

  return {
    series,
    xLabel: '时间 t / s',
    yLabel: '归一化幅度',
    readouts: [
      {
        label: '占用带宽',
        value: `${fixed(measuredBand, 2)} kHz`,
        hint: `理论 ${fixed(theoryBand, 2)} kHz · ${bandHint}`,
        warn: measuredBand > theoryBand * 1.6,
      },
      {
        label: '解调失真',
        value: `${fixed(distortion * 100, 1)}%`,
        hint: '解调输出与消息的归一化均方误差，阈值 5%',
        warn: distortion > 0.05,
      },
      {
        label: '输出信噪比',
        value: `${fixed(outSnr, 1)} dB`,
        hint: `输入 ${fixed(snrIn, 1)} dB · 增益 ${fixed(10 * Math.log10(Math.max(gainDb, 1e-9)), 1)} dB`,
        warn: threshold,
      },
    ],
    conclusion: failed
      ? envelopeFail
        ? '调制度 m 超过 1，包络在过零点翻折，检波出来的波形已经不再是原来的消息——失真读数越过 5%，包络检波失效。'
        : 'FM 输入信噪比跌破门限，输出信噪比断崖式下跌，增加带宽换来的增益在这一段不管用了。'
      : `解调输出贴着消息，失真 ${fixed(distortion * 100, 1)}%，带宽 ${fixed(measuredBand, 2)} kHz 与理论 ${fixed(theoryBand, 2)} kHz 对得上。`,
    failed,
  }
}

function aLawCompress(x: number, A = 87.6): number {
  const ax = Math.abs(x)
  const y = ax < 1 / A ? (A * ax) / (1 + Math.log(A)) : (1 + Math.log(A * ax)) / (1 + Math.log(A))
  return Math.sign(x) * y
}

function aLawExpand(y: number, A = 87.6): number {
  const ay = Math.abs(y)
  const x = ay < 1 / (1 + Math.log(A)) ? (ay * (1 + Math.log(A))) / A : Math.exp(ay * (1 + Math.log(A)) - 1) / A
  return Math.sign(y) * x
}

function computeSource(params: Record<string, number>): CourseView {
  const ratio = params.fs ?? 4
  const bits = params.bits ?? 8
  const companding = params.compand ?? 0
  const fh = 1
  const duration = 4
  const n = 1024
  const dt = duration / n

  const original: number[] = []
  for (let i = 0; i < n; i++) original.push(Math.cos(2 * Math.PI * fh * i * dt))

  // 理想插值重建：抽样率低于 2f_H 时，重建出来的是折回的频率 f'，误差直接体现混叠。
  // 只比较中间段（0.5–3.5 s），两端没有样本可用，端点效应不该算进混叠。
  const fold = Math.abs(fh - Math.round(fh / ratio) * ratio)
  const errs: number[] = []
  const refs: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i * dt
    if (t < 0.5 || t > 3.5) continue
    const rebuilt = ratio >= 2 * fh ? Math.cos(2 * Math.PI * fh * t) : Math.cos(2 * Math.PI * fold * t)
    errs.push(original[i] - rebuilt)
    refs.push(original[i])
  }
  const aliasError = rms(errs) / (rms(refs) || 1)

  // 量化（可选 A 律压扩）：台阶宽 2/2^n，半个台阶抬到格点中心。
  const levels = 2 ** Math.round(bits)
  const quantize = (x: number) => {
    // 压扩开时先把幅度压扁再均匀量化，收端展开：小信号拿到的台阶更细。
    const v = companding === 1 ? aLawCompress(x) : x
    const q = Math.min(levels - 1, Math.max(0, Math.floor(((v + 1) / 2) * levels)))
    const step = ((q + 0.5) / levels) * 2 - 1
    return companding === 1 ? aLawExpand(step) : step
  }
  const quantized = original.map(quantize)
  // 量化信噪比在更密的相位网格上统计，别让 1,024 个点的取样偏差混进来。
  const dense = 8192
  let signalPower = 0
  let noisePower = 0
  for (let i = 0; i < dense; i++) {
    const x = Math.cos((2 * Math.PI * i) / dense)
    const y = quantize(x)
    signalPower += x * x
    noisePower += (y - x) * (y - x)
  }
  signalPower /= dense
  noisePower /= dense
  const snrMeasured = 10 * Math.log10(signalPower / Math.max(noisePower, 1e-18))
  const snrTheory = 6.02 * bits + 1.76
  const bitrate = ratio * fh * bits

  const aliasing = ratio < 2
  // 6.02n + 1.76 dB 只对均匀量化成立；压扩开着时不拿它判红。
  const snrFail = companding === 0 && Math.abs(snrMeasured - snrTheory) > 0.2

  const series: CourseSeries[] = [
    {
      name: '原信号 x(t)',
      color: '#6f8399',
      dashed: true,
      points: original.map((v, i) => [i * dt, v] as [number, number]),
    },
    {
      name: `量化输出（${Math.round(bits)} bit）`,
      color: '#3ce3c6',
      points: quantized.map((v, i) => [i * dt, v] as [number, number]),
    },
  ]

  return {
    series,
    xLabel: '时间 t / s',
    yLabel: '幅度',
    readouts: [
      {
        label: '混叠误差',
        value: aliasing ? `${fixed(aliasError * 100, 1)}%` : `${exponent(aliasError)}`,
        hint: `抽样率 ${fixed(ratio, 2)} f_H，奈奎斯特要求 ≥ 2 f_H`,
        warn: aliasing,
      },
      {
        label: '量化信噪比',
        value: `${fixed(snrMeasured, 2)} dB`,
        hint: `理论 6.02n + 1.76 = ${fixed(snrTheory, 2)} dB（n = ${Math.round(bits)}）`,
        warn: snrFail && !aliasing,
      },
      {
        label: 'PCM 码率',
        value: `${fixed(bitrate, 1)} kb/s`,
        hint: `抽样率 × 量化位数 = ${fixed(ratio, 2)} × ${Math.round(bits)}`,
        warn: false,
      },
    ],
    conclusion: aliasing
      ? `抽样率 ${fixed(ratio, 2)} f_H 低于 2 f_H，谱的高频部分折回来，重建误差 ${fixed(aliasError * 100, 1)}%——这就是混叠。`
      : snrFail && !aliasing
        ? `量化信噪比 ${fixed(snrMeasured, 2)} dB 偏离 6.02n + 1.76 = ${fixed(snrTheory, 2)} dB 超过 0.2 dB，量化台阶没铺满或压扩没还原。`
        : `抽样率 ${fixed(ratio, 2)} f_H 满足奈奎斯特，量化信噪比 ${fixed(snrMeasured, 2)} dB 与 6.02n + 1.76 相差不到 0.2 dB。`,
    failed: aliasing || (snrFail && !aliasing),
  }
}

/* ---------- 第 6 章：数字基带传输的眼图 ---------- */

const alphaParam: CourseParam = { key: 'alpha', label: '滚降系数 α', min: 0.05, max: 1, step: 0.05, unit: '' }
const eyeSnrParam: CourseParam = { key: 'eyeSnrDb', label: '信噪比 Eb/N0', min: 0, max: 30, step: 1, unit: 'dB' }
const timingParam: CourseParam = { key: 'timing', label: '定时误差', min: 0, max: 0.5, step: 0.05, unit: 'Ts' }
const multipathParam: CourseParam = { key: 'multipath', label: '多径', min: 0, max: 1, step: 1, unit: '', options: ['关', '开'] }

const EYE_SEED = 20261027
const EYE_SYMBOLS = 400
const EYE_GRID = 32
const EYE_SPAN = 6
/** 采样时钟偏差，单位是一个码元周期：真实接收机对不上点，正是眼图要防的事。 */

/**
 * 升余弦脉冲的时域值，t 以码元周期为单位。
 * 在 t = ±1/(2α) 处分子分母同时为零，取极限 (π/4)·sinc(t)。
 */
function raisedCosine(t: number, alpha: number): number {
  if (Math.abs(t) < 1e-9) return 1
  const sinc = Math.sin(Math.PI * t) / (Math.PI * t)
  const denom = 1 - (2 * alpha * t) ** 2
  if (Math.abs(denom) < 1e-9) return (Math.PI / 4) * sinc
  return (sinc * Math.cos(Math.PI * alpha * t)) / denom
}

/** 某一时刻的接收值：只累加 ±EYE_SPAN 个码元内的脉冲尾巴，截断本身就是实测的一部分。 */
function eyeSample(t: number, symbols: number[], alpha: number, echo: number): number {
  let sum = 0
  const from = Math.floor(t) - EYE_SPAN
  const to = Math.ceil(t) + EYE_SPAN
  for (let k = from; k <= to; k += 1) {
    if (k < 0 || k >= symbols.length) continue
    sum += symbols[k] * raisedCosine(t - k, alpha)
    if (echo > 0) sum += symbols[k] * echo * raisedCosine(t - k - 0.5, alpha)
  }
  return sum
}

function computeEye(params: Record<string, number>): CourseView {
  const alpha = params.alpha
  const snrDb = params.eyeSnrDb
  const echo = params.multipath === 1 ? 0.5 : 0
  const timing = Math.min(0.5, Math.max(0, params.timing ?? 0))
  const seed = EYE_SEED + Math.round(alpha * 100) * 7 + Math.round(snrDb) * 3 + Math.round(echo * 10) + Math.round(timing * 100) * 11
  const rng = createRng(seed)
  const ebN0 = 10 ** (snrDb / 10)
  const sigma = Math.sqrt(1 / (2 * ebN0))

  const symbols: number[] = []
  for (let k = 0; k < EYE_SYMBOLS; k += 1) symbols.push(rng.next() < 0.5 ? -1 : 1)

  const phases: number[] = []
  for (let i = -EYE_GRID; i <= EYE_GRID; i += 1) phases.push(i / EYE_GRID)
  const columns: number[][] = phases.map(() => [])
  const center: number[] = []
  let errors = 0
  let decided = 0

  for (let m = 10; m < EYE_SYMBOLS - 10; m += 1) {
    for (let i = 0; i < phases.length; i += 1) {
      const value = eyeSample(m + timing + phases[i], symbols, alpha, echo) + sigma * rng.gauss()
      columns[i].push(value)
      if (i === EYE_GRID) {
        center.push(value)
        decided += 1
        if (Math.sign(value) !== Math.sign(symbols[m])) errors += 1
      }
    }
  }

  // 峰值 ISI：同一时刻所有别的码元尾巴（含回波）绝对值的和，可以在纸上算。
  let isi = 0
  for (let k = -EYE_SPAN; k <= EYE_SPAN; k += 1) {
    if (k !== 0) isi += Math.abs(raisedCosine(k + timing, alpha))
    if (echo > 0) isi += echo * Math.abs(raisedCosine(k + timing - 0.5, alpha))
  }

  // 取 2% / 98% 分位而不是极值：极值由 380 条轨迹里最倒霉的那几条噪声决定，
  // 会把开口撑到 2 以上，和「眼高」这个量对不上。
  const quantile = (values: number[], q: number): number => {
    const sorted = [...values].sort((a, b) => a - b)
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
  }
  const upper = columns.map((values) => quantile(values, 0.98))
  const lower = columns.map((values) => quantile(values, 0.02))
  // 眼高按判决点上下两条包络的 p2–p98 区间算，再折半归一到「满开 = 2」，
  // 避免 380 条轨迹里最极端的噪声把读数撑到 2 以上。
  const eyeHeight = Math.min(2, (upper[EYE_GRID] - lower[EYE_GRID]) / 2)
  const theoryHeight = Math.max(0, 2 * (1 - isi))
  const ber = decided > 0 ? errors / decided : 0
  const theoryBer = qFunction(Math.sqrt(2 * ebN0))
  // 采样偏 0.2 个码元时，峰值 ISI 一旦逼近 1，判决点上的余量就被尾巴吃光了。
  const failed = isi > 0.85 || eyeHeight < 0.6 || snrDb <= 8 || (ber > theoryBer * 10 && ber > 0)

  const traces: CourseSeries[] = []
  for (let t = 0; t < 40; t += 1) {
    traces.push({
      name: '迹线',
      color: '#5d7f95',
      quiet: true,
      points: phases.map((p) => [p, eyeSample(40 + t + timing + p, symbols, alpha, echo)] as [number, number]),
    })
  }
  const series: CourseSeries[] = [
    ...traces,
    { name: '上包络（最坏的那个码元）', color: '#3ce3c6', points: phases.map((p, i) => [p, upper[i]] as [number, number]) },
    { name: '下包络（最坏的那个码元）', color: '#8f7fd4', points: phases.map((p, i) => [p, lower[i]] as [number, number]) },
  ]

  const fmtBer = (value: number): string => (value === 0 ? '0（本批没出错）' : value.toExponential(2))

  return {
    series,
    xLabel: '相对判决点的位置（码元周期）',
    yLabel: '接收幅度',
    readouts: [
      {
        label: '眼高（实测）',
        value: eyeHeight.toFixed(2),
        hint: `判决点 p2–p98 区间折半，满开为 2；理论开口 ${theoryHeight.toFixed(2)}`,
        warn: eyeHeight < 0.6,
      },
      {
        label: `峰值 ISI（采样偏 ${timing.toFixed(2)}Ts）`,
        value: isi.toFixed(3),
        hint: `截断到 ±${EYE_SPAN} 个码元、采样偏 ${timing.toFixed(2)} 个码元；超过 0.85 就闭上`,
        warn: isi > 0.85,
      },
      {
        label: '误码率（实测）',
        value: fmtBer(ber),
        hint: `理论 Q(√(2Eb/N0)) = ${theoryBer.toExponential(2)}`,
        warn: ber > theoryBer * 10 && ber > 0,
      },
    ],
    conclusion: failed
      ? snrDb <= 8
        ? '噪声太大，上下两条包络已经叠到一起，判决等于猜。'
        : alpha < 0.2
          ? '滚降压得太小，脉冲尾巴拖到邻近码元上，采样一偏眼图就闭上了。'
          : echo > 0
            ? '多径把同一个码元的能量拖到半个码元之后，判决点上的开口被回波吃掉了。'
            : '眼图快闭上了，先查采样相位。'
      : timing <= 0.01
        ? '采样正好落在判决点上，升余弦的 ISI 理论上是 0；把定时误差拖开，才看得出滚降系数在兜底。'
        : `采样偏了 ${timing.toFixed(2)} 个码元，眼图仍然张着：升余弦把码元间的干扰压在了判决点附近。`,
    failed,
  }
}

const tauParam: CourseParam = { key: 'tau', label: '脉冲宽度 τ', min: 0.2, max: 4, step: 0.1, unit: 'ms' }
const shapeParam: CourseParam = { key: 'shape', label: '脉冲形状', min: 0, max: 1, step: 1, unit: '', options: ['矩形', '三角'] }
const kindParam: CourseParam = { key: 'kind', label: '信号判据', min: 0, max: 1, step: 1, unit: '', options: ['能量信号', '功率信号'] }
const modeParam: CourseParam = {
  key: 'mode',
  label: '调制方式',
  min: 0,
  max: 3,
  step: 1,
  unit: '',
  options: ['AM', 'DSB', 'SSB', 'FM'],
}
const mParam: CourseParam = { key: 'm', label: '调制度 m', min: 0.1, max: 1.5, step: 0.05, unit: '' }
const betaParam: CourseParam = { key: 'beta', label: '调频指数 β', min: 0.5, max: 8, step: 0.5, unit: '' }
const snrParam: CourseParam = { key: 'snrIn', label: '输入信噪比', min: 0, max: 30, step: 1, unit: 'dB' }
const fsParam: CourseParam = { key: 'fs', label: '抽样率 fs / f_H', min: 1, max: 8, step: 0.2, unit: '' }
const bitsParam: CourseParam = { key: 'bits', label: '量化位数 n', min: 8, max: 12, step: 1, unit: 'bit' }
const compandParam: CourseParam = { key: 'compand', label: 'A 律压扩', min: 0, max: 1, step: 1, unit: '', options: ['关', '开'] }

/** 13 章目录。顺序与教材一致，未实现的原因写清楚，不藏。 */
export const COURSE_CHAPTERS: CourseChapter[] = [
  {
    no: 1,
    title: '绪论',
    implemented: false,
    reason: '这一章只有概念与历史，没有可拖的参量；硬做一屏只会变成一段文字。',
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 2,
    title: '确知信号',
    implemented: true,
    reason: '',
    question: '脉冲的自相关，为什么能和它的功率谱对上？',
    params: [tauParam, shapeParam, kindParam],
    defaults: { tau: 1.5, shape: 0, kind: 0 },
    failPreset: { tau: 1.5, shape: 0, kind: 1 },
    compute: computeSignal,
  },
  {
    no: 3,
    title: '随机过程',
    implemented: false,
    reason: '需要大量独立样本才能看出统计量收敛，一屏里的图容易变成噪声云，收益不如直接去 QAM 页看。',
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 4,
    title: '信道',
    implemented: false,
    reason: '多径与 CP 的完整链路已经在 OFDM 实验台里，重复做一屏只会更浅。',
    labs: [{ label: 'OFDM 实验台', href: '#/ofdm' }],
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 5,
    title: '模拟调制',
    implemented: true,
    reason: '',
    question: '调制度超过 1 之后，包络检波为什么就认不出原来的波形了？',
    params: [modeParam, mParam, betaParam, snrParam],
    defaults: { mode: 0, m: 0.6, beta: 2, snrIn: 25 },
    failPreset: { mode: 0, m: 1.4, beta: 2, snrIn: 25 },
    compute: computeModulation,
  },
  {
    no: 6,
    title: '数字基带传输',
    implemented: true,
    reason: '',
    question: '滚降系数压到很小、采样又偏了一点，眼图为什么就闭上了？',
    params: [alphaParam, eyeSnrParam, multipathParam, timingParam],
    defaults: { alpha: 0.35, eyeSnrDb: 20, multipath: 0, timing: 0 },
    failPreset: { alpha: 0.05, eyeSnrDb: 20, multipath: 0, timing: 0.45 },
    compute: computeEye,
  },
  {
    no: 7,
    title: '数字带通传输',
    implemented: false,
    reason: 'ASK/FSK/PSK 的星座与误码曲线已被第 8 章的 QAM 实验台覆盖，单独一屏信息量不足。',
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 8,
    title: '新型数字带通调制',
    implemented: false,
    reason: 'QAM 与 OFDM 的完整实验台已经在第 4、7 章的位置之外单独存在，这里只放入口。',
    labs: [
      { label: 'QAM 实验台', href: '#/qam' },
      { label: 'OFDM 实验台', href: '#/ofdm' },
    ],
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 9,
    title: '数字信号的最佳接收',
    implemented: false,
    reason: '匹配滤波与最大似然判决要一整页公式，一屏里放不下；判决那一半由第 11 章的 Viterbi 实验台承担。',
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 10,
    title: '信源编码',
    implemented: true,
    reason: '',
    question: '抽样率降到 2 倍最高频率以下，频谱里多出来的那些东西是什么？',
    params: [fsParam, bitsParam, compandParam],
    defaults: { fs: 4, bits: 8, compand: 0 },
    failPreset: { fs: 1.2, bits: 8, compand: 0 },
    compute: computeSource,
  },
  {
    no: 11,
    title: '差错控制编码',
    implemented: false,
    reason: '卷积码与 Viterbi 的完整实验台已经存在，这里只放入口。',
    labs: [{ label: '卷积码实验台', href: '#/conv' }],
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 12,
    title: '正交编码与伪随机序列',
    implemented: false,
    reason: 'm 序列与 Walsh 码需要码序列发生器，和现有四个实验台的数据形状都不同，下一轮单独做。',
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
  {
    no: 13,
    title: '同步原理',
    implemented: false,
    reason: '载波同步与位同步要画相位误差随时间的漂移，一屏里至少两条时间轴，留到功能冻结前再评估。',
    question: '',
    params: [],
    defaults: {},
    failPreset: {},
  },
]

/** 有深度实验台的章号，页面左树打 ●。 */
export const DEEP_LAB_CHAPTERS = [4, 8, 11]

export function chapterByNo(no: number): CourseChapter | undefined {
  return COURSE_CHAPTERS.find((c) => c.no === no)
}
