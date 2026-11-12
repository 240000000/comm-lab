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
  /** 加粗：第 9 章当前选中的那条波形。 */
  bold?: boolean
  /** 只画散点、不连线；第 7 章的蒙特卡洛实测点用它。 */
  marker?: boolean
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
  /** 纵轴取对数（第 7 章的误码率曲线）。 */
  logY?: boolean
  logX?: boolean
  /** 画成从 0 基线拉出来的柱（第 12 章的自相关）。 */
  bars?: boolean
  /** 画成堆叠柱（第 11 章：每档按结局分段）。 */
  stack?: boolean
  /** 参考线：虚线横线加一行标注（第 12 章的 −1/N）。 */
  guides?: Array<{ y: number; label: string }>
  /** 标注贴哪边。默认左对齐；「一条线压着一族柱」的图放右上角更不挡数据。 */
  guideLabelAlign?: 'left' | 'right'
  /** 竖参考线：标出「当前取的是第几根柱」（第 12 章的 τ）。只做渲染，不碰任何 compute。 */
  markerX?: number
  markerLabel?: string
  /** 章节自己指定坐标范围（第 10 章固定 ±0.05、第 12 章固定 [0,127]）；不传就走自动缩放。 */
  xRange?: [number, number]
  yRange?: [number, number]
  /** 高亮某一根柱（第 11 章当前 errors 那一档）；不传就按原样全画。 */
  highlightX?: number
  /** 章节自己指定刻度（第 1 章）；不传就走通用图的自动算法，其余 12 章零影响。 */
  xTicks?: number[]
  yTicks?: number[]
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

/**
 * 周期脉冲串：周期 Tp（毫秒）必须整除窗长 T = 8，循环自相关才不会在窗的
 * 边界上接错位。每个周期里只放一个完整脉冲（2τ ≤ Tp），所以峰的位置就是
 * Tp 的整数倍，峰高是平均功率 E/Tp。
 */
function periodicSamples(tauMs: number, shape: number, periodMs: number): number[] {
  const n = 256
  const T = 8
  const dt = T / n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const local = (i * dt) % periodMs
    if (local >= tauMs) {
      out.push(0)
    } else if (shape === 0) {
      out.push(1)
    } else {
      out.push(1 - Math.abs((2 * local) / tauMs - 1))
    }
  }
  return out
}

function spectrumSquared(samples: number[]): number[] {
  const x: Complex[] = samples.map((v) => ({ re: v, im: 0 }))
  return dft(x).map((c) => c.re * c.re + c.im * c.im)
}

/** 错用幅度谱：拿 |X| 当功率谱。少了一次平方，反变换回来的已经不是自相关。 */
function spectrumMagnitude(samples: number[]): number[] {
  const x: Complex[] = samples.map((v) => ({ re: v, im: 0 }))
  return dft(x).map((c) => Math.hypot(c.re, c.im))
}

/** 实数谱的反变换：补零虚部，取实部。 */
function idftReal(spectrum: number[]): number[] {
  return idft(spectrum.map((v) => ({ re: v, im: 0 }))).map((c) => c.re)
}

function computeSignal(params: Record<string, number>): CourseView {
  const tau = params.tau ?? 1.5
  const shape = params.shape ?? 0
  const kind = params.kind ?? 0
  const n = 256
  const T = 8
  const dt = T / n
  // 功率档换真周期信号：单脉冲只是能量信号，拿同一个 pulseSamples 再除个窗长
  // 在物理上不成立，两档的图才会长得一模一样。Tp 只从能整除窗长的档里挑，
  // 取第一个装得下一个完整脉冲的（2τ ≤ Tp）。
  const periodCandidates = [1, 2, 4, 8]
  const period = kind === 1 ? (periodCandidates.find((p) => p >= 2 * tau) ?? 8) : 0
  const singlePulse = pulseSamples(tau, shape)
  const samples = kind === 1 ? periodicSamples(tau, shape, period) : singlePulse
  // 反例档把幅度谱当功率谱：少一次平方，反变换出来的曲线形状就不对了。
  const used = idftReal(kind === 2 ? spectrumMagnitude(samples) : spectrumSquared(samples))
  // 参照那条线永远走正规的 |X|²，两档才比得出「同一个归一化下还差多少」。
  const reference = kind === 2 ? idftReal(spectrumSquared(samples)) : used
  // 单脉冲的能量 ∫x²dt；功率档的峰高是平均功率 P = E/Tp，不是这个数。
  const energyPeak = singlePulse.reduce((sum, v) => sum + v * v * dt, 0)

  // 对偶：能量信号的功率谱是 |X|²，功率信号要再除以周期 T。
  // 两条线共用同一个除数，图上比的就只剩「谱有没有用错」。
  const expectedDivisor = kind === 0 ? 1 : T
  let worst = 0
  let peakAbs = 0
  for (let m = 0; m < n; m += 1) {
    const measured = (used[m] * dt) / expectedDivisor
    const fromPsd = (reference[m] * dt) / expectedDivisor
    worst = Math.max(worst, Math.abs(measured - fromPsd))
    peakAbs = Math.max(peakAbs, Math.abs(fromPsd))
  }
  const deviation = worst / (peakAbs || 1)

  // 相邻峰间隔直接从曲线上量：找第一个超过 1/4 峰高的局部极大，滞后乘 dt。
  let spacingLags = 0
  for (let m = 1; m < n; m += 1) {
    const value = Math.abs(used[m])
    if (
      value >= 0.25 * peakAbs &&
      value >= Math.abs(used[m - 1]) &&
      value >= Math.abs(used[(m + 1) % n])
    ) {
      spacingLags = m
      break
    }
  }
  const measuredPeriod = spacingLags > 0 ? spacingLags * dt : period

  // 相关峰宽度按半高全宽报：先找最后一个高于半高的整数滞后，再在它和下一个
  // 采样点之间连直线求半高穿越点，穿越滞后乘 2 就是全宽。只数整数滞后的话，
  // τ 与采样间隔同量级时会被 dt 量化吃掉一截，那不是物理下限。
  const halfLevel = Math.max(...used.map(Math.abs)) / 2
  let aboveLags = 0
  let belowLags = 1
  for (let m = 1; m < n / 2; m += 1) {
    if (Math.abs(used[m]) > halfLevel) {
      aboveLags = m
      belowLags = m + 1
    } else {
      belowLags = m
      break
    }
  }
  const aboveLevel = Math.abs(used[aboveLags])
  const belowLevel = Math.abs(used[belowLags % n])
  const levelSpan = aboveLevel - belowLevel
  const crossFrac = levelSpan > 0 ? (aboveLevel - halfLevel) / levelSpan : 0
  const measuredWidth = (aboveLags + crossFrac) * dt * 2
  const theoryWidth = tau

  const pointsOf = (source: number[]): [number, number][] =>
    Array.from(
      { length: n },
      (_, m): [number, number] => [
        (m - n / 2) * dt,
        (source[(m + n / 2) % n] * dt) / expectedDivisor,
      ],
    )
  const series: CourseSeries[] = [
    {
      name: kind === 2 ? '幅度谱 |X| 反变换' : '实测自相关 R(τ)',
      color: '#3ce3c6',
      points: pointsOf(used),
    },
    {
      name: '由功率谱反变换',
      color: '#8f7fd4',
      dashed: true,
      points: pointsOf(reference),
    },
  ]

  const failed = deviation > 1e-3
  const peakLevel = used[0] * dt
  // 图上刻度与能量口径差一个窗长，两行读数各报各的，不许混成一个数。
  const peakReadouts: CourseReadout[] =
    kind === 0
      ? [
          {
            label: '自相关峰值 R(0)',
            value: fixed(peakLevel, 4),
            hint: `理论 E = ${fixed(energyPeak, 4)}`,
            warn: failed,
          },
        ]
      : kind === 1
        ? [
            {
              label: '平均功率 P',
              value: fixed(peakLevel / T, 4),
              hint: `P = E / Tp：单脉冲能量 E = ${fixed(energyPeak, 4)}、Tp = ${fixed(period, 2)} ms（峰高的实际读数就是这个 P）。`,
              warn: failed,
            },
            {
              label: '相邻峰间隔',
              value: `${fixed(measuredPeriod, 2)} ms`,
              hint: '从曲线上量出来的：自相关按 Tp 重复，τ 再大也不会衰到零。',
              warn: false,
            },
          ]
        : [
            {
              label: '图上 曲线峰值/T',
              value: fixed(peakLevel / T, 4),
              hint: `这条曲线是 |X| 的反变换，不是自相关；图上实线用的就是这个刻度，峰再除以窗长 T = ${fixed(T, 2)} ms。`,
              warn: failed,
            },
            {
              label: '原始 曲线峰值',
              value: fixed(peakLevel, 4),
              hint: `谱用错了，这个峰已经不等于能量 E = ${fixed(energyPeak, 4)}。`,
              warn: failed,
            },
          ]

  const readouts: CourseReadout[] = [
    ...peakReadouts,
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

  const nearZero = deviation < 1e-12 ? '0' : exponent(deviation)
  const conclusion =
    kind === 2
      ? `把幅度谱 |X| 当成功率谱，少了一次平方：反变换出来的不是自相关，整条曲线形状都变了，对偶偏差 ${exponent(deviation)}——两条线再也对不上，判据 1e-3 过不了。功率谱必须是 |X|²，不是 |X|。`
      : kind === 1
        ? `能量信号的自相关只在脉冲宽度内非零，τ 再大就归零，峰的读数直接是能量 E。功率信号换成了周期 Tp = ${fixed(period, 2)} ms 的脉冲串，自相关跟着按周期重复、τ 再大也不会衰到零——它读的是平均功率 P = E/Tp = ${fixed(peakLevel / T, 4)}，不是能量。两条线照样贴在一起，偏差 ${nearZero}。`
        : `两条线贴在一起：能量信号的功率谱就是 |X|²，反变换正好回到自相关，偏差 ${nearZero}，远小于 1e-3。虚线与实线的尺度完全一样、又被画在上面，所以屏幕上只剩一条——不是漏画。`

  return {
    series,
    xLabel: '时延 τ / ms',
    yLabel: 'R(τ)',
    readouts,
    conclusion,
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

// 绘图用噪声的种子：固定常量 + 四元参数组合，保证同参数同图、换参数必换图。
const MIX_SEED = 20261113

// 结论句与 hint 按图上噪声的相对幅度（σ 相对消息峰值 1.0）分档：0.15 以下还干净，0.5 以上基本被盖住。
const NOISE_QUIET = 0.15
const NOISE_BURIED = 0.5

function computeModulation(params: Record<string, number>): CourseView {
  const mode = params.mode ?? 0
  const m = params.m ?? 0.6
  const beta = params.beta ?? 2
  const snrIn = params.snrIn ?? 25
  const fm = 1.5
  // 教材里的调频指数 β 就是 D = Δf/fm。要让滑块上拖的 β 真的等于 D，消息得先
  // 归一化到「导数峰值 = 1」，再让相位乘上 β·fm：这样瞬时频偏恰好是 β·fm，
  // D = Δf/fm 才等于 β，Carson 上限 2(β+1)fm 才对得上。
  // 归一化前这条消息的导数峰值是 1.2（单位 kHz，已除过 2π）。
  const fmMsgPeak = 1.2
  const fmMsg = (t: number) =>
    (0.7 * Math.sin(2 * Math.PI * t) + (0.5 * Math.sin(2 * Math.PI * 1.5 * t)) / 1.5) / fmMsgPeak
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
      const phi = 2 * Math.PI * fc * t + beta * fm * fmMsg(t)
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
    // 理想鉴频器：相位求导，扣掉载频，剩下的是 β·fm·m归一(t)。
    // 中心差分：取 i-1 与 i+1 两点，导数正好落在第 i 点上，不引入半样本延迟。
    demod = phase.map((_, i) => {
      const prev = phase[Math.max(i - 1, 0)]
      const next = phase[Math.min(i + 1, phase.length - 1)]
      const steps = i === 0 || i === phase.length - 1 ? 1 : 2
      return (next - prev) / (2 * Math.PI * dt * steps) - fc
    })
    // 除以 β·fm 才能还原归一化后的消息；β 或 fm 很小时留一个下限防止数值炸开。
    demod = demod.map((v) => v / Math.max(beta * fm, 0.2))
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
        ? '消息两条线在 1 与 1.5 kHz，上边带只占 f_c+1 到 f_c+1.5，所以是 0.5 kHz；一般情况 SSB 带宽等于消息最高频'
        : '消息最高 1.5 kHz，双边带占 3 kHz'
  // 制度增益是输出信噪比与输入信噪比之比，两个功率之比，无量纲。
  // 单音 FM 的标准式 G = 3β²(β+1)：β=1 时为 6，即 +7.78 dB。
  // 解调器噪声按角频率积分的那个 2π 是单位换算，已经包含在该式的口径里，不能再除一次。
  const gainDb =
    mode === 0 ? (2 * m * m) / (2 + m * m) : mode === 1 ? 2 : mode === 2 ? 1 : 3 * beta * beta * (beta + 1)
  let outSnr = snrIn + 10 * Math.log10(Math.max(gainDb, 1e-9))
  // 门限效应：β 越大，鉴频器要过的带宽越宽，门限来得越早。
  // 拐点取经验式 10 + 3·log2(1+β) dB，拐点之下按 2.5 dB/dB 掉——示意模型，不是解析结果。
  const fmKnee = 10 + 3 * Math.log2(1 + beta)
  let threshold = false
  if (mode === 3 && snrIn < fmKnee) {
    outSnr -= (fmKnee - snrIn) * 2.5
    threshold = true
  }
  const envelopeFail = mode === 0 && m > 1
  const failed = envelopeFail || threshold

  // 只给绘图用的含噪解调波形：σ 由「输出信噪比」读数换回幅度比，读数本身仍走理想路径。
  const mixSigma = Math.pow(10, -outSnr / 20)
  const mixRng = createRng(
    MIX_SEED + mode * 1009 + Math.round(m * 100) * 31 + Math.round(beta * 10) * 17 + Math.round(snrIn) * 7,
  )
  const noisy = aligned.map((v) => v + mixSigma * mixRng.gauss())

  const series: CourseSeries[] = [
    {
      name: '消息 m(t)',
      color: '#6f8399',
      dashed: true,
      points: msg.map((v, i) => [i * dt, v] as [number, number]),
    },
    {
      name: '解调输出（含噪声）',
      color: '#3ce3c6',
      points: noisy.map((v, i) => [i * dt + from * dt, v] as [number, number]),
    },
  ]

  const bandRatio = measuredBand / theoryBand

  return {
    series,
    xLabel: '时间 t / s',
    yLabel: '归一化幅度',
    readouts: [
      {
        label: '占用带宽',
        value: `${fixed(measuredBand, 2)} kHz`,
        hint: `理论 ${fixed(theoryBand, 2)} kHz（实测占理论的 ${fixed(bandRatio * 100, 0)}%）· ${bandHint}`,
        warn: Math.abs(measuredBand - theoryBand) > theoryBand * 0.3,
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
        hint:
          (mode === 3
            ? `输入 ${fixed(snrIn, 1)} dB · 制度增益 3β²(β+1) = ${fixed(10 * Math.log10(Math.max(gainDb, 1e-9)), 2)} dB（β=${fixed(beta, 1)}）· 门限拐点 ${fixed(fmKnee, 1)} dB 是示意模型，不是解析结果`
            : `输入 ${fixed(snrIn, 1)} dB · 增益 ${fixed(10 * Math.log10(Math.max(gainDb, 1e-9)), 1)} dB`) + ` · ${noiseHint(mixSigma)}`,
        warn: threshold,
      },
    ],
    conclusion: failed
      ? envelopeFail
        ? '调制度 m 超过 1，包络在过零点翻折，检波出来的波形已经不再是原来的消息——失真读数越过 5%，包络检波失效。'
        : `FM 输入信噪比跌破门限（β=${fixed(beta, 1)} 时拐点在 ${fixed(fmKnee, 1)} dB），输出信噪比断崖式下跌，增加带宽换来的增益在这一段不管用了。`
      : `${noiseSentence(mixSigma, outSnr, distortion)}带宽实测 ${fixed(measuredBand, 2)} kHz，${mode === 3 ? '是 Carson 上限' : '是理论值'} ${fixed(theoryBand, 2)} kHz 的 ${fixed(bandRatio * 100, 0)}%——${mode === 3 ? '98% 能量带宽天然比上限窄，β 越大越贴近上限。' : mode === 2 ? '本图消息只有 1 kHz 与 1.5 kHz 两条谱线，上边带从 f_c+1 到 f_c+1.5，所以只占 0.5 kHz；一般情况 SSB 带宽等于消息最高频。' : '两条谱线都被搬过去，双边带正好占满。'}`,
    failed,
  }
}

// 结论句与 hint 共用同一套分档，避免「图上被噪声盖住」还配一句「贴着消息」。
function noiseTierPhrase(sigma: number): string {
  if (sigma < NOISE_QUIET) return '图上基本干净'
  if (sigma < NOISE_BURIED) return '图上开始起毛'
  return '图上已被噪声盖住'
}

function noiseHint(sigma: number): string {
  return `图上这条线按这个信噪比标了噪声（σ = ${fixed(sigma, 3)}，${noiseTierPhrase(sigma)}）`
}

function noiseSentence(sigma: number, outSnr: number, distortion: number): string {
  const snr = fixed(outSnr, 1)
  const level = fixed(sigma, 3)
  const pct = fixed(distortion * 100, 1)
  if (sigma < NOISE_QUIET) {
    return `解调输出贴着消息，失真与带宽读数都按理想路径算、不是从图上量的；图上这条线按输出信噪比 ${snr} dB 标了噪声（σ = ${level}），只有细看才见毛刺。`
  }
  if (sigma < NOISE_BURIED) {
    return `解调输出开始起毛，还能看出消息形状；读数是按理想路径算的，不是从这张图上量的，图上这条线按输出信噪比 ${snr} dB 标了噪声（σ = ${level}）。`
  }
  return `这条线已经被噪声盖住，图上看不出消息；但失真读数仍按理想路径算，是 ${pct}%，不是从这张图上量的，图上按输出信噪比 ${snr} dB 标了噪声（σ = ${level}）。`
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

  // 量化（可选 A 律压扩）：2^n 个格点，量程比信号峰值多留半个台阶。
  // 留这半个台阶是有原因的：正弦峰值恰好压在量程边界上会被削顶，
  // 那部分误差远大于 q/2，6.02n + 1.76 的前提（误差在 ±q/2 内均匀）就不成立了——
  // 四位时这一削顶就要吃掉 0.5 dB，正好等于旧判据里那笔对不上的账。
  const levels = 2 ** Math.round(bits)
  const guard = 1 / levels
  const floorLevel = -1 - guard
  const span = 2 + 2 * guard
  const quantizeWith = (x: number, compand: number) => {
    // 压扩开时先把幅度压扁再均匀量化，收端展开：小信号拿到的台阶更细。
    const v = compand === 1 ? aLawCompress(x) : x
    const q = Math.min(levels - 1, Math.max(0, Math.floor(((v - floorLevel) / span) * levels)))
    const step = floorLevel + (q + 0.5) * (span / levels)
    return compand === 1 ? aLawExpand(step) : step
  }
  const quantize = (x: number) => quantizeWith(x, companding)
  // 量化信噪比在更密的相位网格上统计，别让 1,024 个点的取样偏差混进来。
  const dense = 8192
  const measureSnr = (compand: number) => {
    let signal = 0
    let noise = 0
    for (let i = 0; i < dense; i++) {
      const x = Math.cos((2 * Math.PI * i) / dense)
      const y = quantizeWith(x, compand)
      signal += x * x
      noise += (y - x) * (y - x)
    }
    return 10 * Math.log10(signal / Math.max(noise, 1e-18))
  }
  const snrMeasured = measureSnr(companding)
  // 压扩档要一个参照：同样位数、同样信号，不开压扩的均匀量化实测值。
  const snrUniform = companding === 1 ? measureSnr(0) : snrMeasured
  const snrTheory = 6.02 * bits + 1.76
  // 判据用相对误差：差值除以理论值。6.02n + 1.76 是渐近式，
  // 位数越少（台阶越粗）偏得越多，绝对阈值会把四位数一律判红。
  const snrError = (snrMeasured - snrTheory) / snrTheory
  const compandDelta = snrMeasured - snrUniform
  const bitrate = ratio * fh * bits

  const aliasing = ratio < 2
  // 两套判据，各管各的：
  // 均匀档比 6.02n + 1.76（相对差 2% 以内）；压扩档拿它没意义——那个式子只对均匀量化成立——
  // 改判「压扩在满量程正弦上必须是净损失」：压扩把台阶按幅度重分配，小信号变细、大信号变粗，
  // 本例信号正好铺满量程，所以信噪比只会比同位数均匀量化低、不会高；高出来就是压扩没生效。
  const snrFail = companding === 1 ? compandDelta >= 0 : Math.abs(snrError) > 0.02

  // 抽样 → 量化 → 零阶保持：主图画两条阶梯——原信号 s(t) 与量化重建波形。
  // 台阶高度由位数决定（3 位时 0.25，8 位时 0.0078），台阶宽度由抽样率决定，
  // 压扩把台阶按幅度重新分配；三个参数各自都动这条线。
  // 横轴只画前 8 个抽样间隔：位数一降，台阶立刻有半个屏幕高；8 位时看不见
  // 是物理事实（0.0078 在图上不到 2 px），位数对小信号的意义交给下面那条
  // SQNR 读数去说，不靠换一张图表达。
  // 三条读数仍由上面那条 8192 点密网格与解析式算出，不经过这里的阶梯。
  const sampleCount = Math.max(2, Math.round(ratio * fh * duration))
  const sampleStep = duration / sampleCount
  const shown = Math.min(8, sampleCount)
  const spanEnd = shown * sampleStep
  // 零阶保持的阶梯点：每个抽样间隔给「本样值 → 下一个样值」两段水平线。
  const stairPoints = (values: number[]): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    for (let k = 0; k < values.length; k += 1) {
      const t = k * sampleStep
      const next = (k + 1) * sampleStep
      out.push([t, values[k]])
      out.push([next, values[k]])
    }
    return out
  }
  const exactValues: number[] = []
  const rebuiltValues: number[] = []
  for (let k = 0; k < shown; k += 1) {
    const t = k * sampleStep
    const exact = Math.cos(2 * Math.PI * fh * t)
    exactValues.push(exact)
    rebuiltValues.push(quantize(exact))
  }

  const series: CourseSeries[] = [
    {
      name: '原信号 s(t)',
      color: '#8fb3d1',
      points: stairPoints(exactValues),
    },
    {
      name: `抽样重建（${Math.round(bits)} bit，零阶保持）`,
      color: '#3ce3c6',
      points: stairPoints(rebuiltValues),
    },
  ]

  return {
    series,
    xLabel: '时间 t / s',
    yLabel: '幅度',
    xRange: [0, spanEnd],
    readouts: [
      {
        label: '混叠误差',
        value: aliasing ? `${fixed(aliasError * 100, 1)}%` : `${exponent(aliasError)}`,
        hint: `抽样率 ${fixed(ratio, 2)} f_H，奈奎斯特要求 ≥ 2 f_H`,
        warn: aliasing,
      },
      {
        label: companding === 1 ? '量化信噪比（A 律）' : '量化信噪比',
        value: `${fixed(snrMeasured, 2)} dB`,
        hint:
          companding === 1
            ? `同位数均匀量化实测 ${fixed(snrUniform, 2)} dB，压扩后 ${fixed(snrMeasured, 2)} dB（差 ${compandDelta >= 0 ? '+' : ''}${fixed(compandDelta, 2)} dB）；本图信号铺满量程，压扩只该是净损失，差值为正说明压扩没生效`
            : `理论 6.02n + 1.76 = ${fixed(snrTheory, 2)} dB（n = ${Math.round(bits)}）；相对差 ${fixed(snrError * 100, 2)}%，阈值 2%`,
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
      : companding === 1
        ? snrFail
          ? `A 律档不套 6.02n + 1.76（那个只对均匀量化成立），改跟同位数均匀量化的实测值比：压扩后 ${fixed(snrMeasured, 2)} dB 反而比均匀的 ${fixed(snrUniform, 2)} dB 高 ${fixed(compandDelta, 2)} dB，可本图信号铺满量程，压扩只该是净损失——压扩这条路没走通。`
          : `A 律档不套 6.02n + 1.76（那个只对均匀量化成立），改跟同位数均匀量化的实测值比：压扩后 ${fixed(snrMeasured, 2)} dB，均匀的是 ${fixed(snrUniform, 2)} dB，差 ${fixed(compandDelta, 2)} dB。压扩把台阶按幅度重新分配，小信号拿到的台阶更细、大信号更粗；本图信号铺满量程，落在粗的这一头，所以整体是净损失——压扩换的不是总信噪比，是信噪比在幅度上的分布。`
        : snrFail
          ? `量化信噪比 ${fixed(snrMeasured, 2)} dB，相对 6.02n + 1.76 = ${fixed(snrTheory, 2)} dB 差 ${fixed(snrError * 100, 2)}%，越过 2% 阈值，量化台阶没铺满。`
          : `抽样率 ${fixed(ratio, 2)} f_H 满足奈奎斯特，量化信噪比 ${fixed(snrMeasured, 2)} dB 与 6.02n + 1.76 = ${fixed(snrTheory, 2)} dB 差 ${fixed(snrError * 100, 2)}%，在 2% 以内。`,
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
  // 这两个参数没传时算不出眼图，按章表默认档兜底，别让 compute({}) 出 NaN。
  const alpha = params.alpha ?? 0.35
  const snrDb = params.eyeSnrDb ?? 20
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
  // 判决点上的两条分簇：+1 的样本与 -1 的样本分开收，后面各取内沿。
  const plusCenter: number[] = []
  const minusCenter: number[] = []
  let errors = 0
  let decided = 0

  for (let m = 10; m < EYE_SYMBOLS - 10; m += 1) {
    for (let i = 0; i < phases.length; i += 1) {
      const value = eyeSample(m + timing + phases[i], symbols, alpha, echo) + sigma * rng.gauss()
      columns[i].push(value)
      if (i === EYE_GRID) {
        center.push(value)
        if (symbols[m] > 0) plusCenter.push(value)
        else minusCenter.push(value)
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
  // 眼高要按发送符号分簇算：+1 那一簇的上沿取 p2、-1 那一簇的下沿取 p98，
  // 两者相减就是「最靠里的两只眼睛之间的距离」。满开是 2，直接用它比。
  // 旧写法取两簇混在一起的 p2–p98 再折半，噪声一大外侧分位反而往外撑，
  // 数值会往上走——方向和「眼图闭了」相反，是量纲错。
  const eyeUp = quantile(plusCenter, 0.02)
  const eyeDown = quantile(minusCenter, 0.98)
  const eyeHeight = Math.max(0, Math.min(2, eyeUp - eyeDown))
  const theoryHeight = Math.max(0, 2 * (1 - isi))
  const ber = decided > 0 ? errors / decided : 0
  const theoryBer = qFunction(Math.sqrt(2 * ebN0))
  // 判定只看三个读数：眼高、峰值 ISI、误码率。不再带 snrDb <= 8 的硬阈值——
  // 低信噪比但眼还张着的时候，硬判闭眼会和屏幕上的读数打架。
  const failed = isi > 0.85 || eyeHeight < 0.6 || (ber > theoryBer * 10 && ber > 0)

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
        hint: `判决点上 +1 簇 p2 减 −1 簇 p98，满开为 2；理论开口 ${theoryHeight.toFixed(2)}`,
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
        hint: `理论 Q(√(2Eb/N0)) = ${theoryBer.toExponential(2)}（只计噪声、不含 ISI）`,
        warn: ber > theoryBer * 10 && ber > 0,
      },
    ],
    // 结论完全按读数分支，先看最硬的那条：眼高被压到 0.6 以下才说闭眼。
    conclusion:
      eyeHeight < 0.6
        ? `眼高只剩 ${eyeHeight.toFixed(2)}，上下两条包络在判决点上已经叠到一起，判决基本靠猜。`
        : ber > theoryBer * 10 && ber > 0
          ? `误码率 ${fmtBer(ber)} 是理论值的十倍以上，这一批确实判错了；峰值 ISI ${isi.toFixed(3)}，眼高还有 ${eyeHeight.toFixed(2)}。`
          : isi > 0.85
            ? `峰值 ISI ${isi.toFixed(3)}，脉冲尾巴拖到邻近码元上，判决点上的余量快被吃光了。`
            : `还开着，只是开口从默认档收窄了：眼高 ${eyeHeight.toFixed(2)}、峰值 ISI ${isi.toFixed(3)}、误码率 ${fmtBer(ber)}，三条线一条都没踩。`,
    failed,
  }
}

const tauParam: CourseParam = { key: 'tau', label: '脉冲宽度 τ', min: 0.2, max: 4, step: 0.1, unit: 'ms' }
const shapeParam: CourseParam = { key: 'shape', label: '脉冲形状', min: 0, max: 1, step: 1, unit: '', options: ['矩形', '三角'] }
const kindParam: CourseParam = {
  key: 'kind',
  label: '信号判据',
  min: 0,
  max: 2,
  step: 1,
  unit: '',
  options: ['能量信号', '功率信号', '错用幅度谱'],
}
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
const bitsParam: CourseParam = { key: 'bits', label: '量化位数 n', min: 3, max: 12, step: 1, unit: 'bit' }
const compandParam: CourseParam = { key: 'compand', label: 'A 律压扩', min: 0, max: 1, step: 1, unit: '', options: ['关', '开'] }

/** 13 章目录。顺序与教材一致，未实现的原因写清楚，不藏。 */

/* ---------- 第 7 章：四种二进制带通调制，差的那 3 dB 到底差在哪 ---------- */

const BAND_SCHEMES = ['2ASK', '2FSK', '2PSK', '2DPSK'] as const
const BAND_COLORS = ['#7fb3d5', '#e0a45c', '#5ad1a5', '#c58bf0']
/** 蒙特卡洛样本数；固定种子，所以同一档每次重跑结果逐位相同。 */
const BAND_SAMPLES = 20000
const BAND_SEED = 20261107
/** 曲线横轴 0…12 dB，每 1 dB 一个点。 */
const BAND_POINTS = 13

const bandSchemeParam: CourseParam = {
  key: 'scheme',
  label: '调制方式',
  min: 0,
  max: 3,
  step: 1,
  unit: '',
  options: [...BAND_SCHEMES],
}
const bandEbn0Param: CourseParam = {
  key: 'ebn0Db',
  label: 'Eb/N0',
  min: 0,
  max: 12,
  step: 1,
  unit: 'dB',
}
const bandPhaseParam: CourseParam = {
  key: 'phaseDeg',
  label: '相干载波相位误差 φ',
  min: 0,
  max: 45,
  step: 5,
  unit: '°',
}

/** 相位误差打掉的有效能量：只有相干检测的 2ASK / 2PSK 吃 cos²φ。 */
function coherentLoss(phaseDeg: number): number {
  return Math.cos((phaseDeg * Math.PI) / 180) ** 2
}

/** 四种调制的理论误码率；全部现算，不抄教材上的数。 */
function bandTheory(scheme: number, ebn0Db: number, phaseDeg: number): number {
  const gamma = 10 ** (ebn0Db / 10)
  const loss = coherentLoss(phaseDeg)
  if (scheme === 0) return qFunction(Math.sqrt(gamma * loss)) // 2ASK 单极性 OOK
  if (scheme === 1) return qFunction(Math.sqrt(gamma)) // 2FSK 相干
  if (scheme === 3) return 0.5 * Math.exp(-gamma) // 2DPSK 差分相干
  return qFunction(Math.sqrt(2 * gamma * loss)) // 2PSK 相干
}

/**
 * 反解 2FSK 的 Q(√γ)：给定一个误码率，问 2FSK 要多少 γ 才达到它。
 * Q 随 γ 单调下降，二分即可，不需要闭式解。
 */
function fskGammaFor(ber: number): number {
  let lo = 1e-6
  let hi = 1e4
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if (qFunction(Math.sqrt(mid)) > ber) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 蒙特卡洛：按当前档的判决式逐比特送噪声，数错了多少个。 */
function shootBits(scheme: number, ebn0Db: number, phaseDeg: number): number {
  const rng = createRng(BAND_SEED + scheme * 101 + Math.round(ebn0Db) * 7 + Math.round(phaseDeg / 5) * 13)
  const gamma = 10 ** (ebn0Db / 10)
  const amp = scheme === 1 ? Math.sqrt(gamma) : Math.sqrt(2 * gamma * coherentLoss(phaseDeg))
  let errors = 0
  for (let i = 0; i < BAND_SAMPLES; i += 1) {
    const bit = rng.next() < 0.5 ? 0 : 1
    let wrong: boolean
    if (scheme === 3) {
      // 差分相干：拿前一个码元当参考，判据是复相关 Re(r1·conj(r2)) 的符号。
      // 参考码元与当前码元各带一路独立的复噪声（实虚各 N(0,1)，噪声功率 2），
      // 幅度取 √(2γ) 使每码元 Es = 2γ，于是 Eb/N0 = Es/2 = γ。
      // 两条支路都带噪声，判决量的信噪比才真的是 γ，蒙特卡洛才落在 0.5·exp(−Eb/N0) 上。
      const a = Math.sqrt(2 * gamma)
      const r1Re = a + rng.gauss()
      const r1Im = rng.gauss()
      const r2Re = (bit === 1 ? a : -a) + rng.gauss()
      const r2Im = rng.gauss()
      const product = r1Re * r2Re + r1Im * r2Im
      wrong = bit === 1 ? product < 0 : product > 0
    } else if (scheme === 0) {
      // 单极性 OOK：σ=1 时 Eb = 2γ，峰值幅度取 A = 2√(γ·loss)，
      // 判决门限摆在 A/2 = √(γ·loss) 上，这样噪声才正好落在 Q(√(γ·loss)) 这条线上。
      const a = 2 * Math.sqrt(gamma * coherentLoss(phaseDeg))
      const z = (bit === 1 ? a : 0) + rng.gauss()
      wrong = bit === 1 ? z < a / 2 : z > a / 2
    } else {
      const z = (bit === 1 ? amp : -amp) + rng.gauss()
      wrong = bit === 1 ? z < 0 : z > 0
    }
    if (wrong) errors += 1
  }
  return errors / BAND_SAMPLES
}

function computeBandpass(params: Record<string, number>): CourseView {
  // 没传档位时按章表默认的 2PSK 兜底；默认 0 会把「没参数」算成 2ASK。
  const scheme = Math.min(3, Math.max(0, Math.round(params.scheme ?? 2)))
  const ebn0Db = Math.min(12, Math.max(0, Math.round(params.ebn0Db ?? 8)))
  const phaseDeg = Math.min(45, Math.max(0, Math.round((params.phaseDeg ?? 0) / 5) * 5))
  const label = BAND_SCHEMES[scheme]

  // 四条理论曲线画在同一坐标系里，当前档再叠一组实测点。
  const series: CourseSeries[] = BAND_SCHEMES.map((name, index) => ({
    name,
    color: BAND_COLORS[index],
    points: Array.from({ length: BAND_POINTS }, (_, i) => [i, bandTheory(index, i, phaseDeg)] as [number, number]),
  }))

  const theoryBer = bandTheory(scheme, ebn0Db, phaseDeg)
  const measuredBer = shootBits(scheme, ebn0Db, phaseDeg)
  series.push({
    name: `${label} 实测`,
    color: BAND_COLORS[scheme],
    marker: true,
    points: [[ebn0Db, measuredBer]],
  })

  // 同一条误码率水平线上，2FSK 要比当前档多花多少 dB。
  const gammaNow = 10 ** (ebn0Db / 10)
  const gainDb = 10 * Math.log10(fskGammaFor(theoryBer) / gammaNow)
  const phaseLostDb = -10 * Math.log10(coherentLoss(phaseDeg))
  // 只有「单支路 + cos²φ 损失」的相干检测（2PSK / 2ASK）才会被相位误差拖到与 2FSK 打平。
  // 2FSK 在本模型里两路正交、判决只用一路幅度，理论式与仿真都不含 cos²φ 这一项，
  // φ 对它零影响，所以不能把它也判成 collapsed。
  const collapsed = scheme !== 1 && phaseDeg >= 40 && Math.abs(gainDb) < 0.5

  const deviate = measuredBer > 0 && (measuredBer > theoryBer * 3 || measuredBer < theoryBer / 3)
  const errors = Math.round(measuredBer * BAND_SAMPLES)

  const readouts: CourseReadout[] = [
    {
      label: `${label} 理论误码率`,
      value: exponent(theoryBer),
      hint:
        scheme === 0
          ? `Q(√(Eb/N0·cos²φ))：单极性 OOK 要付的代价——平均每比特能量只有峰值幅度的一半，同样的峰值就白丢 3 dB。${phaseDeg > 0 ? `相位误差 ${phaseDeg}° 再打下 ${phaseLostDb.toFixed(2)} dB。` : ''}`
          : scheme === 1
            ? 'Q(√(Eb/N0))：2FSK 两路正交，同样的 Eb 只有一路能量在起作用。'
            : scheme === 3
              ? '0.5·exp(−Eb/N0)：差分相干不恢复载波，代价是比相干 2PSK 差一截。'
              : `Q(√(2Eb/N0·cos²φ))：相位误差 ${phaseDeg}° 先把有效能量打下 ${phaseLostDb.toFixed(2)} dB。`,
      warn: false,
    },
    {
      label: '实测误码率（20000 比特）',
      value: exponent(measuredBer),
      hint: `${errors} / ${BAND_SAMPLES} 比特判错；与理论比 ${measuredBer === 0 ? '本批没出错' : `${(measuredBer / theoryBer).toFixed(2)} 倍`}`,
      warn: deviate,
    },
    {
      label: '相对 2FSK 的增益',
      value: `${Math.abs(gainDb) < 0.05 ? '' : gainDb > 0 ? '' : '−'}${Math.abs(gainDb) < 0.05 ? '0.0' : Math.abs(gainDb).toFixed(1)} dB`,
      hint: collapsed
        ? `相位误差吃了 ${phaseLostDb.toFixed(2)} dB，与 2FSK 已经打平。`
        : `同样误码率下，2FSK 要 ${(ebn0Db + gainDb).toFixed(1)} dB，当前档 ${ebn0Db.toFixed(1)} dB。`,
      warn: collapsed || Math.abs(gainDb) < 0.5,
    },
  ]

  let conclusion: string
  if (collapsed) {
    conclusion = `相位误差 45 度吃掉了整整 3 dB，2PSK 现在和 2FSK 打平：增益 ${gainDb.toFixed(1)} dB，曲线退到 2FSK 上，那个「省 3 dB」的结论就没了。`
  } else if (scheme === 1) {
    conclusion =
      phaseDeg > 0
        ? `2FSK 不需要相干载波相位：两路正交各走各的，接收端比的是两路能量谁大，φ 只让两路一起缩一点，判决门限跟着缩，误码率不动。理论式和实测里都没有 cos²φ 这一项，相位误差 ${phaseDeg} 度对它零影响，实测仍贴着 Q(√(Eb/N0))。`
        : `2FSK 自己就是基准，增益 0.0 dB；同样误码率下 2PSK 只要 ${Math.max(0, ebn0Db - 3.01).toFixed(1)} dB，差的正是那 3 dB。`
  } else if (phaseDeg > 0) {
    conclusion = `相位误差 ${phaseDeg} 度先吃掉 ${phaseLostDb.toFixed(2)} dB，剩下的才是 ${label} 相对 2FSK 的净增益 ${gainDb.toFixed(1)} dB。`
  } else {
    conclusion = `2PSK 的曲线整体比 2FSK 往左移 3.01 dB：同样的误码率，2FSK 要 ${(ebn0Db + gainDb).toFixed(1)} dB，2PSK 只要 ${(ebn0Db + gainDb - 3.01).toFixed(1)} dB。这 3 dB 相对 2ASK 和 2FSK 两条线都成立——它俩都落在 Q(√γ) 上，图上重合，所以参照的不是唯一一条线。`
  }

  return {
    series,
    xLabel: 'Eb/N0（dB）',
    yLabel: '误码率 Pb',
    logY: true,
    readouts,
    conclusion,
    failed: collapsed,
  }
}

/* ---------- 第 8 章：方形 QAM，多传的那点比特要用多少 dB 换 ---------- */

const QAM_ORDERS = [4, 16, 64, 256] as const
const QAM_LABELS = ['QPSK', '16QAM', '64QAM', '256QAM'] as const
const QAM_COLORS = ['#7fb3d5', '#e0a45c', '#5ad1a5', '#c58bf0']
/** 蒙特卡洛符号数；固定种子，同一档每次重跑逐位相同。 */
const QAM_SAMPLES = 20000
const QAM_SEED = 20261108
/** 曲线横轴 0…20 dB，每 1 dB 一个点。 */
const QAM_POINTS = 21

const qamModParam: CourseParam = {
  key: 'mod',
  label: '调制阶数 M',
  min: 0,
  max: 3,
  step: 1,
  unit: '',
  options: QAM_LABELS.map((name, index) => `${name}（M=${QAM_ORDERS[index]}）`),
}
const qamEbn0Param: CourseParam = {
  key: 'ebn0Db',
  label: 'Eb/N0（按它取值，图上按 C/N 展开）',
  min: 0,
  max: 20,
  step: 1,
  unit: 'dB',
}
const qamAlphaParam: CourseParam = {
  key: 'alpha',
  label: '滚降系数 α',
  min: 0,
  max: 1,
  step: 0.05,
  unit: '',
}

/** 方形星座的标准近似：Pb ≈ (4/k)(1 − 1/√M)·Q(√(3k·Eb/((M−1)N0)))。 */
function qamTheory(order: number, ebn0Db: number): number {
  const k = Math.log2(order)
  const gamma = 10 ** (ebn0Db / 10)
  const arg = Math.sqrt((3 * k * gamma) / (order - 1))
  return (4 / k) * (1 - 1 / Math.sqrt(order)) * qFunction(arg)
}

/** 反解「达到某个误码率要多少 Eb/N0」：Q 单调，二分即可。 */
function qamGammaFor(order: number, ber: number): number {
  let lo = 1e-6
  let hi = 1e6
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if (qamTheory(order, 10 * Math.log10(mid)) > ber) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 格雷码：相邻星座点只差一位，这样按位异或数出来的错比特不会虚高。 */
function grayOf(index: number): number {
  return index ^ (index >> 1)
}

/**
 * 蒙特卡洛：逐符号独立加噪 → 判 I/Q → 格雷映射数错比特。
 * 链路里没有成型滤波，也不设采样偏差：理想误码率本来就不随滚降系数变，
 * 想让 α 去动 BER 曲线，只能靠人造码间串扰，那是画出来的假偏差。
 * α 的真实作用在带宽上——同样带宽里能塞多少比特——所以它体现在横轴
 * （C/N 相对 Eb/N0 的平移）上，见 computeQam 里的 shiftDb。
 */
function shootQam(
  order: number,
  ebn0Db: number,
): { ber: number; errors: number; bits: number } {
  const rng = createRng(QAM_SEED + order * 131 + Math.round(ebn0Db) * 7)
  const gamma = 10 ** (ebn0Db / 10)
  const k = Math.log2(order)
  const side = Math.round(Math.sqrt(order))
  // 每维噪声方差取 1（即 N0 = 2），电平间隔 d 由平均符号能量 Es = k·Eb 定出。
  const d = Math.sqrt((3 * k * gamma) / (order - 1))
  const levelI = (index: number) => 2 * (index % side) - (side - 1)
  const levelQ = (index: number) => 2 * Math.floor(index / side) - (side - 1)
  let errors = 0
  for (let m = 0; m < QAM_SAMPLES; m += 1) {
    const symbol = Math.floor(rng.next() * order)
    const ri = levelI(symbol) * d + rng.gauss()
    const rq = levelQ(symbol) * d + rng.gauss()
    const di = Math.min(side - 1, Math.max(0, Math.round((ri / d + (side - 1)) / 2)))
    const dq = Math.min(side - 1, Math.max(0, Math.round((rq / d + (side - 1)) / 2)))
    const decided = dq * side + di
    if (decided !== symbol) {
      let diff = grayOf(symbol) ^ grayOf(decided)
      while (diff > 0) {
        errors += diff & 1
        diff >>= 1
      }
    }
  }
  const bits = QAM_SAMPLES * k
  return { ber: errors / bits, errors, bits }
}

function computeQam(params: Record<string, number>): CourseView {
  const mod = Math.min(3, Math.max(0, Math.round(params.mod ?? 1)))
  const ebn0Db = Math.min(20, Math.max(0, Math.round(params.ebn0Db ?? 12)))
  const alpha = Math.min(1, Math.max(0, Math.round((params.alpha ?? 0.35) * 20) / 20))
  const order = QAM_ORDERS[mod]
  const label = QAM_LABELS[mod]
  const k = Math.log2(order)

  // 横轴换成 C/N：C/N = (Eb/N0)·log₂M/(1+α)，成型滤波多出来的带宽全在这里。
  // 每条曲线按自己的 log₂M/(1+α) 平移，所以四档位移互不相同：α 从 0.05 拉到 0.9，
  // 同一条曲线横移 10log10(1.90/1.05) = 2.58 dB，滑块一拖整族曲线跟着走。
  // 读数仍按 Eb/N0 报——那是链路本身的指标，不随带宽怎么定义而变。
  const shiftDb = 10 * Math.log10(k / (1 + alpha))
  // 读数按 Eb/N0 报（链路指标），图上横轴是 C/N——两个口径同时写出来，免得读数和横坐标对不上。
  const dualAxis = `按 Eb/N0 取值：Eb/N0 ${ebn0Db.toFixed(1)} dB，图上折算 C/N ${(ebn0Db + shiftDb).toFixed(1)} dB。`
  const series: CourseSeries[] = QAM_ORDERS.map((value, index) => ({
    name: QAM_LABELS[index],
    color: QAM_COLORS[index],
    points: Array.from(
      { length: QAM_POINTS },
      (_, i) => [i + 10 * Math.log10(Math.log2(value) / (1 + alpha)), qamTheory(value, i)] as [number, number],
    ),
  }))

  const theoryBer = qamTheory(order, ebn0Db)
  const shot = shootQam(order, ebn0Db)
  const measuredBer = shot.ber
  series.push({
    name: `${label} 实测`,
    color: QAM_COLORS[mod],
    marker: true,
    points: [[ebn0Db + shiftDb, measuredBer]],
  })

  const efficiency = k / (1 + alpha)
  const moreBits = ((k - 4) / 4) * 100
  const gammaNow = 10 ** (ebn0Db / 10)
  const gammaSameBer = qamGammaFor(16, theoryBer)
  const extraDb = 10 * Math.log10(gammaNow / gammaSameBer)
  const extra64 = 10 * Math.log10(qamGammaFor(64, theoryBer) / gammaSameBer)
  // 链路里没有人造码间串扰，实测与理论只剩蒙特卡洛抖动：20,000 个符号
  // （12 dB 下约 12 个错）本来就该落在 3 倍以内，所以判据回到 3 倍。
  const deviate = measuredBer > 0 && (measuredBer > theoryBer * 3 || measuredBer < theoryBer / 3)
  const failed = mod === 3 && theoryBer > 0.01

  const readouts: CourseReadout[] = [
    {
      label: '谱效率',
      value: `${efficiency.toFixed(2)} bit/s/Hz`,
      hint: `log₂M/(1+α) = ${k}/(1+${alpha.toFixed(2)})；滚降越小，同样带宽里塞的比特越多。${dualAxis}`,
      warn: false,
    },
    {
      label: '理论误码率',
      value: exponent(theoryBer),
      hint: `(4/k)(1−1/√M)·Q(√(3k·Eb/((M−1)N0)))，k = ${k}；M=4 时退化成 2PSK 的 Q(√(2Eb/N0))。${dualAxis}`,
      warn: failed,
    },
    {
      label: '实测误码率',
      value: measuredBer === 0 ? '0（本批没出错）' : exponent(measuredBer),
      hint: `${shot.errors} / ${shot.bits} 比特判错；与理论比 ${measuredBer === 0 ? '本批没出错' : `${(measuredBer / theoryBer).toFixed(2)} 倍`}。${dualAxis}`,
      warn: deviate || failed,
    },
  ]

  let conclusion: string
  if (failed) {
    conclusion = `同样这 ${ebn0Db} dB，256QAM 每传 20 个符号就错一个：理论 ${exponent(theoryBer)}、实测 ${exponent(measuredBer)}。多传的那一倍比特全赔进去了，这个信噪比下它没用。`
  } else if (mod === 1) {
    conclusion = `16QAM 每赫兹传 ${efficiency.toFixed(2)} bit，${ebn0Db} dB 下理论 ${exponent(theoryBer)}。同样这条误码率，64QAM 要多花 ${extra64.toFixed(1)} dB，换来多传 50% 的比特；256QAM 多传一倍，贵得也更多。教材常按每比特 3 dB 粗估成 6 dB，按方形星座式精确算是 ${extra64.toFixed(1)} dB。`
  } else if (moreBits > 0) {
    conclusion = `${label} 比 16QAM 多传 ${moreBits.toFixed(0)}% 的比特（每赫兹 ${efficiency.toFixed(2)} bit），代价是同一条误码率下多花 ${extraDb.toFixed(1)} dB。`
  } else {
    conclusion = `${label} 每赫兹只传 ${efficiency.toFixed(2)} bit，比 16QAM 少 ${Math.abs(moreBits).toFixed(0)}% 的比特，省下 ${Math.abs(extraDb).toFixed(1)} dB。`
  }
  // 横轴是 C/N，α 变大会把整条曲线往左推，读起来像「滚降越大越好」——代价记在带宽利用率里。
  conclusion += `别把左移读成「滚降越大越好」：同样带宽里能塞的比特率是 log₂M/(1+α) = ${efficiency.toFixed(2)} bit/s/Hz，α 越大这个数越小。滚降是拿带宽换旁瓣，不是白捡的 dB。`

  return {
    series,
    xLabel: 'C/N（dB）',
    yLabel: '误码率 Pb',
    logY: true,
    readouts,
    conclusion,
    failed,
  }
}

/* ---------- 第 9 章：匹配滤波，波形换成什么样峰值信噪比都不变 ---------- */

const MATCH_WAVES = ['矩形', '三角', '半正弦'] as const
const MATCH_COLORS = ['#5ad1a5', '#e0a45c', '#c58bf0']
/** 非当前档用压暗的同色系，图例里三条都在，但不抢主线。 */
const MATCH_DIM = ['#2f6b57', '#6b5a35', '#5a4568']
/** 蒙特卡洛比特数；固定种子，同一档重跑逐位相同。 */
const MATCH_SAMPLES = 20000
const MATCH_SEED = 20261109
/** 相关用的离散点数（1024 点一段码元）与画图的相对时刻点数。 */
const MATCH_GRID = 1024
const MATCH_POINTS = 81

const matchWaveParam: CourseParam = {
  key: 'wave',
  label: '发送波形',
  min: 0,
  max: 2,
  step: 1,
  unit: '',
  options: [...MATCH_WAVES],
}
const matchDtParam: CourseParam = {
  key: 'dt',
  label: '采样失配 Δt',
  min: 0,
  max: 0.5,
  step: 0.05,
  unit: 'Ts',
}
const matchEbn0Param: CourseParam = {
  key: 'ebn0Db',
  label: 'Eb/N0',
  min: 0,
  max: 12,
  step: 1,
  unit: 'dB',
}

/** 一个码元内的三种波形，能量各自不同但都会被归一化掉。 */
function matchShape(wave: number, t: number): number {
  if (t < 0 || t >= 1) return 0
  if (wave === 0) return 1
  if (wave === 1) return 1 - Math.abs(2 * t - 1)
  return Math.sin(Math.PI * t)
}

/** 连续取值用网格线性插值，分数位移才有一致的算法，不用给波形写分段解析式。 */
function matchAt(wave: number, t: number): number {
  const pos = t * MATCH_GRID
  const i = Math.floor(pos)
  const frac = pos - i
  const a = matchShape(wave, i / MATCH_GRID)
  const b = matchShape(wave, (i + 1) / MATCH_GRID)
  return a + (b - a) * frac
}

function matchEnergy(wave: number): number {
  let sum = 0
  for (let i = 0; i < MATCH_GRID; i += 1) {
    const v = matchShape(wave, i / MATCH_GRID)
    sum += v * v
  }
  return sum / MATCH_GRID
}

/** 归一化自相关：τ=0 时恒为 1，所以峰值与波形形状无关。 */
function matchCorr(wave: number, tau: number): number {
  let sum = 0
  for (let i = 0; i < MATCH_GRID; i += 1) {
    const t = i / MATCH_GRID
    sum += matchShape(wave, t) * matchAt(wave, t - tau)
  }
  return sum / MATCH_GRID / matchEnergy(wave)
}

/** 采样偏了 Δt，相关峰只剩 ρ(Δt)，噪声方差不变。 */
function shootMatch(rho: number, ebn0Db: number): number {
  const rng = createRng(MATCH_SEED + Math.round(rho * 1000) * 13 + Math.round(ebn0Db) * 7)
  const amp = rho * Math.sqrt(2 * 10 ** (ebn0Db / 10))
  let errors = 0
  for (let i = 0; i < MATCH_SAMPLES; i += 1) {
    const bit = rng.next() < 0.5 ? 0 : 1
    const z = (bit === 1 ? amp : -amp) + rng.gauss()
    const decided = z > 0 ? 1 : 0
    if (decided !== bit) errors += 1
  }
  return errors / MATCH_SAMPLES
}

function computeMatch(params: Record<string, number>): CourseView {
  const wave = Math.min(2, Math.max(0, Math.round(params.wave ?? 0)))
  const dt = Math.min(0.5, Math.max(0, Math.round((params.dt ?? 0) * 20) / 20))
  const ebn0Db = Math.min(12, Math.max(0, Math.round(params.ebn0Db ?? 8)))
  const gamma = 10 ** (ebn0Db / 10)
  const label = MATCH_WAVES[wave]

  const rho = matchCorr(wave, dt)
  const snrDb = 10 * Math.log10(2 * gamma)
  const lossDb = -20 * Math.log10(Math.max(rho, 1e-6))
  const theoryBer = qFunction(Math.sqrt(2 * rho * rho * gamma))
  const measuredBer = shootMatch(rho, ebn0Db)
  const cleanBer = qFunction(Math.sqrt(2 * gamma))
  const deviate = measuredBer > 0 && (measuredBer > theoryBer * 3 || measuredBer < theoryBer / 3)

  // 接收端噪声的一个实现：σ = 10^(−SNR/20)，只叠在当前选中的那条波形上。
  // 种子按档位固定，换波形、换 Δt、换 Eb/N0 各得到一条可复现的实现，不是每帧重掷的随机数。
  const sigma = 10 ** (-snrDb / 20)
  const series: CourseSeries[] = MATCH_WAVES.map((name, index) => ({
    name,
    color: index === wave ? MATCH_COLORS[index] : MATCH_DIM[index],
    quiet: index !== wave,
    bold: index === wave,
    points: Array.from({ length: MATCH_POINTS }, (_, i) => {
      const tau = -1 + (2 * i) / (MATCH_POINTS - 1)
      return [tau, matchCorr(index, tau)] as [number, number]
    }),
  }))
  const noiseRng = createRng(MATCH_SEED + wave * 17 + Math.round(dt * 100) * 3 + ebn0Db * 7 + 1)
  series.push({
    name: `含噪匹配滤波输出（σ = ${sigma.toFixed(3)}）`,
    color: '#ffd166',
    dashed: true,
    points: Array.from({ length: MATCH_POINTS }, (_, i) => {
      const tau = -1 + (2 * i) / (MATCH_POINTS - 1)
      return [tau, matchCorr(wave, tau) + sigma * noiseRng.gauss()] as [number, number]
    }),
  })
  if (dt > 0) {
    series.push({
      name: '失配后的相关输出',
      color: '#e05c5c',
      dashed: true,
      points: Array.from({ length: MATCH_POINTS }, (_, i) => {
        const tau = -1 + (2 * i) / (MATCH_POINTS - 1)
        return [tau, rho * matchCorr(wave, tau - dt)] as [number, number]
      }),
    })
  }

  const loss = lossDb
  const readouts: CourseReadout[] = [
    {
      label: '峰值信噪比（理论）',
      value: `${snrDb.toFixed(1)} dB`,
      hint: `10·log10(2Eb/N0) = ${snrDb.toFixed(1)} dB；只与能量有关，与波形形状无关。`,
      warn: false,
    },
    {
      label: '失配损失',
      value: `${loss.toFixed(2)} dB`,
      hint: `归一化相关 ρ(${dt.toFixed(2)}Ts) = ${rho.toFixed(3)}；损失 = −20·log10ρ。`,
      warn: loss > 1,
    },
    {
      label: '采样点信噪比',
      value: `${(snrDb - loss).toFixed(1)} dB`,
      hint: `10·log10(2ρ²γ) = ${snrDb.toFixed(1)} − ${loss.toFixed(2)} = ${(snrDb - loss).toFixed(1)} dB；峰值信噪比是滤波器能给出的上限，采样点信噪比是这一次实际拿到的。`,
      warn: snrDb - loss < 8,
    },
    {
      label: '误码率',
      value: exponent(theoryBer),
      hint: `理论 Q(√(2ρ²γ))；实测 ${exponent(measuredBer)}（${MATCH_SAMPLES} 比特）。`,
      warn: deviate || loss > 3,
    },
  ]

  const failed = loss > 3
  let conclusion: string
  if (failed) {
    conclusion = `滤波器没错，是采样点偏了 ${dt.toFixed(2)} 个码元：${label}波的 ρ 掉到 ${rho.toFixed(2)}，${loss.toFixed(2)} dB 白送掉，误码率从 ${exponent(cleanBer)} 掉到 ${exponent(theoryBer)}。`
  } else if (dt > 0) {
    conclusion = `采样偏了 ${dt.toFixed(2)} 个码元，ρ 还有 ${rho.toFixed(2)}，只丢 ${loss.toFixed(2)} dB；峰值信噪比仍是 ${snrDb.toFixed(1)} dB——偏的是采样时刻，不是波形。`
  } else {
    conclusion = `三种波形能量一样，峰值信噪比都是 ${snrDb.toFixed(1)} dB：匹配滤波器只认能量，不挑形状，差别只在脉冲形状合不合它的喜好。`
  }

  return {
    series,
    xLabel: '相对时刻（码元）',
    yLabel: '归一化输出',
    readouts,
    conclusion,
    failed,
  }
}

/* ---------- 第 12 章：m 序列的自相关为什么只有 1 和 −1/N ---------- */

/** 四档级数，各配一个本原多项式（抽头写成 x 的幂次，含最高次）。 */
const MSEO_TAPS: Record<number, number[]> = {
  4: [4, 1],
  5: [5, 2],
  6: [6, 1],
  7: [7, 3],
}
/** 反例抽头：n=7 换成 1 + x + x³ + x⁴ + x⁷，周期从 127 掉到 35。 */
const MSEO_BAD_TAPS: Record<number, number[]> = {
  4: [4, 1],
  5: [5, 2],
  6: [6, 1],
  7: [1, 3, 4, 7],
}
const MSEO_LEVELS = [4, 5, 6, 7]
/** 初始状态三档，默认全 1。 */
const MSEO_INITS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1],
]

const mseqLevelParam: CourseParam = {
  key: 'level',
  label: '级数 n',
  min: 0,
  max: 3,
  step: 1,
  unit: '',
  options: MSEO_LEVELS.map((n) => `n=${n}（N=${2 ** n - 1}）`),
}
const mseqTauParam: CourseParam = {
  key: 'tau',
  label: '延迟 τ',
  min: 0,
  max: 126,
  step: 1,
  unit: '',
}
const mseqTapsParam: CourseParam = {
  key: 'taps',
  label: '反馈多项式',
  min: 0,
  max: 1,
  step: 1,
  unit: '',
  options: ['本原抽头', '非本原抽头'],
}

/** 线性反馈移位寄存器：a[i] = ⊕ a[i−t]，t 取抽头。 */
function mseqBits(level: number, taps: number[], init: number[], length: number): number[] {
  const a = init.slice(0, level)
  for (let i = level; i < length; i += 1) {
    let bit = 0
    for (const t of taps) bit ^= a[i - t]
    a.push(bit)
  }
  return a
}

/** 在一段序列上找出最小的周期 p；找不到就退回上限。 */
function mseqPeriod(bits: number[], limit: number): number {
  for (let p = 1; p <= limit; p += 1) {
    let ok = true
    for (let i = 0; i + p < bits.length; i += 1) {
      if (bits[i] !== bits[i + p]) {
        ok = false
        break
      }
    }
    if (ok) return p
  }
  return limit
}

/** 循环自相关：R(τ) = (1/N)·Σ s[i]·s[(i+τ) mod N]，s 由 0/1 转成 ±1。 */
function mseqAuto(bits: number[]): number[] {
  const n = bits.length
  const s = bits.map((b) => 1 - 2 * b)
  return Array.from({ length: n }, (_, tau) => {
    let sum = 0
    for (let i = 0; i < n; i += 1) sum += s[i] * s[(i + tau) % n]
    return sum / n
  })
}

function computeMseq(params: Record<string, number>): CourseView {
  const levelIdx = Math.min(3, Math.max(0, Math.round(params.level ?? 3)))
  const level = MSEO_LEVELS[levelIdx]
  // 抽头两档：本原多项式给出满周期 m 序列；非本原多项式给出短周期序列，这才是本章真正的反例。
  const tapsIdx = Math.min(1, Math.max(0, Math.round(params.taps ?? 0)))
  const tapsText = tapsIdx === 1 ? '非本原' : '本原'
  const init = MSEO_INITS[0].slice(0, level)
  const bad = tapsIdx === 1
  const taps = (bad ? MSEO_BAD_TAPS : MSEO_TAPS)[level]
  const full = 2 ** level - 1
  const tau = Math.min(full - 1, Math.max(0, Math.round(params.tau ?? 0)))

  const raw = mseqBits(level, taps, init, 4 * full)
  const period = mseqPeriod(raw, full)
  const bits = raw.slice(0, period)
  const auto = mseqAuto(bits)
  const peak = auto[0]
  let sidelobe = -Infinity
  for (let i = 1; i < auto.length; i += 1) sidelobe = Math.max(sidelobe, auto[i])
  const ones = bits.filter((b) => b === 1).length
  const balance = 2 * ones - period
  const theorySide = -1 / period
  const distinct = [...new Set(auto.map((v) => v.toFixed(9)))].length
  const failed = period !== full

  // 画两个周期：R(τ) 以 N 为周期，τ=N 那里又是一根顶到 1 的杆，
  // 「周期」是画出来的而不是读出来的——一眼能看见第二根尖峰就在 N 处。
  const shown = 2 * period
  const series: CourseSeries[] = [
    {
      name: `R(τ) · n=${level}（N=${period}）· ${tapsText}抽头 ${taps.join(',')}`,
      color: '#5ad1a5',
      points: Array.from({ length: shown }, (_, i) => [i, auto[i % period]] as [number, number]),
    },
  ]

  const readouts: CourseReadout[] = [
    {
      label: `周期 N（${tapsText}抽头）`,
      value: `${period}`,
      hint: `2^${level} − 1 = ${full}；整条序列一个周期正好 ${period} 个码元。`,
      warn: failed,
    },
    {
      label: '峰值自相关',
      value: peak.toFixed(4),
      hint: `R(0) = 1：能量归一化之后，自己和自己对齐必然是满值；当前延迟 τ = ${tau}，R(τ) = ${auto[tau].toFixed(4)}。`,
      warn: Math.abs(peak - 1) > 1e-9,
    },
    {
      label: '最大旁瓣',
      value: sidelobe.toFixed(4),
      hint: `理论 −1/N = ${theorySide.toFixed(5)}；${period - 1} 个非零延迟应当全落在这条线上。`,
      warn: Math.abs(sidelobe - theorySide) > 1e-6,
    },
    {
      label: '平衡性（1 的个数 − 0 的个数）',
      value: `${balance}`,
      hint: `一个周期里 ${ones} 个 1、${period - ones} 个 0；m 序列的平衡性正好差 1。`,
      warn: balance !== 1,
    },
    {
      label: '当前延迟 τ 的 R(τ)',
      value: tau === 0 ? peak.toFixed(4) : auto[tau].toFixed(5),
      hint:
        tau === 0
          ? `图上那条竖线标在第 ${tau} 根柱上；τ=0 是峰值 R(0) = ${peak.toFixed(4)}。`
          : `图上那条竖线标在第 ${tau} 根柱上；τ≠0 时落进旁瓣，R(τ) = ${auto[tau].toFixed(5)}（= −1/${period} = ${theorySide.toFixed(5)}）。`,
      warn: false,
    },
    {
      label: `序列前 8 位（n=${level}）`,
      value: raw.slice(0, 8).join(''),
      hint: `反馈多项式抽头取 (${taps.join(', ')})，初态 ${init.join('')}：换抽头就是换多项式，序列本身跟着换。`,
      warn: false,
    },
  ]

  let conclusion: string
  if (failed) {
    conclusion = `抽头一换，周期从 ${full} 掉到 ${period}：序列还是 0/1 序列，但自相关不再是双值——屏上一共 ${distinct} 个值，最大旁瓣 ${sidelobe.toFixed(4)} 也离开了 −1/N。拿去做扩频，就分不清「同相」和「错一位」。`
  } else {
    conclusion = `${period} 个延迟里，自相关只有两个值：τ=0 处 1，其余 ${period - 1} 个全是 −1/${period} = ${theorySide.toFixed(5)}。这就是扩频能抗多址干扰的底：别人错开一个码元，相关输出就掉到噪声量级。这两个值来自${tapsText}抽头 (${taps.join(', ')}) 定下的反馈多项式，而不是某一段具体码：把抽头切到「非本原」，N 从 ${full} 掉下来，自相关立刻不再只有两个值。`
  }

  return {
    series,
    xLabel: '延迟 τ（码元）',
    yLabel: '归一化自相关',
    readouts,
    conclusion,
    failed,
    bars: true,
    // x 轴由 N 现算：正好铺满两个周期，换级数时轴跟着变，但「两根尖峰相隔 N」永远看得见。
    xRange: [0, shown - 1],
    // 纵轴固定，只给旁瓣与峰值留一点余量：换档时柱高不重新标定，比较才成立。
    yRange: [-1.5 / period, 1.05],
    yTicks: [0, theorySide, 1],
    guides: [{ y: theorySide, label: `−1/N = ${theorySide.toFixed(5)}：其余 ${period - 1} 根柱都在这条线上` }],
    guideLabelAlign: 'right',
    markerX: tau,
    markerLabel: `τ = ${tau}`,
  }
}

/* ---------- 第 11 章：汉明码的纠错边界，e=2 为什么反而更糟 ---------- */

/** 三档汉明码：(n, k)，校验位 m = n − k。 */
const HAMMING_CODES = [
  { n: 7, k: 4 },
  { n: 15, k: 11 },
  { n: 31, k: 26 },
] as const
const HAMMING_RESULT_COLORS = ['#5ad1a5', '#e0a45c', '#c58bf0']

const hamLevelParam: CourseParam = {
  key: 'level',
  label: '码长档',
  min: 0,
  max: 2,
  step: 1,
  unit: '',
  options: ['(7,4)', '(15,11)', '(31,26)'],
}
const hamErrorsParam: CourseParam = {
  key: 'errors',
  label: '错误个数 e',
  min: 0,
  max: 3,
  step: 1,
  unit: '',
}

/** 校验矩阵第 i 列就是 i 的二进制（第 1 列在最左）。 */
function hammingColumn(index: number, m: number): number[] {
  return Array.from({ length: m }, (_, bit) => (index >> bit) & 1)
}

/** H·r 的模 2 结果，按二进制读成一个整数，正好等于列号。 */
function hammingSyndrome(bits: number[], m: number): number {
  let syndrome = 0
  for (let bit = 0; bit < m; bit += 1) {
    let acc = 0
    for (let i = 0; i < bits.length; i += 1) acc ^= bits[i] & hammingColumn(i + 1, m)[bit]
    syndrome |= acc << bit
  }
  return syndrome
}

/** 枚举全部重量不超过 w 的错误模式；用来量最小距离，避免枚举 2^k 个码字。 */
function hammingMinDistance(n: number, m: number): number {
  const bits = new Array<number>(n).fill(0)
  for (let weight = 1; weight <= 3; weight += 1) {
    const walk = (start: number, left: number): boolean => {
      if (left === 0) return hammingSyndrome(bits, m) === 0
      for (let i = start; i < n; i += 1) {
        bits[i] = 1
        if (walk(i + 1, left - 1)) return true
        bits[i] = 0
      }
      return false
    }
    if (walk(0, weight)) return weight
  }
  return 4
}

function combinations<T>(items: T[], pick: number): T[][] {
  const out: T[][] = []
  const walk = (start: number, acc: T[]) => {
    if (acc.length === pick) {
      out.push([...acc])
      return
    }
    for (let i = start; i < items.length; i += 1) {
      acc.push(items[i])
      walk(i + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

interface HammingTally {
  corrected: number
  miscorrected: number
  silent: number
  total: number
}

function hammingTally(n: number, m: number, errors: number): HammingTally {
  const tally = { corrected: 0, miscorrected: 0, silent: 0, total: 0 }
  for (const pattern of combinations([...Array(n).keys()], errors)) {
    const bits = new Array<number>(n).fill(0)
    for (const index of pattern) bits[index] = 1
    const syndrome = hammingSyndrome(bits, m)
    tally.total += 1
    if (syndrome === 0) {
      // 一个错都没有时，原样通过就是答对了；有权重的多错才是静默放行。
      if (errors === 0) tally.corrected += 1
      else tally.silent += 1
      continue
    }
    const flipped = [...bits]
    flipped[syndrome - 1] ^= 1
    if (flipped.every((b) => b === 0)) tally.corrected += 1
    else tally.miscorrected += 1
  }
  return tally
}

function computeHamming(params: Record<string, number>): CourseView {
  const level = Math.min(2, Math.max(0, Math.round(params.level ?? 0)))
  const errors = Math.min(3, Math.max(0, Math.round(params.errors ?? 1)))
  const { n, k } = HAMMING_CODES[level]
  const m = n - k
  const distance = hammingMinDistance(n, m)
  const correctable = Math.floor((distance - 1) / 2)
  const current = hammingTally(n, m, errors)
  const correctRate = current.total === 0 ? 0 : (current.corrected / current.total) * 100
  const miscorrectRate = current.total === 0 ? 0 : (current.miscorrected / current.total) * 100
  const bucket = 2 ** k

  const counts = [0, 1, 2, 3].map((e) => ({ e, ...hammingTally(n, m, e) }))
  const series: CourseSeries[] = [
    { name: '正确纠回', color: HAMMING_RESULT_COLORS[0], points: counts.map((c) => [c.e, c.corrected] as [number, number]) },
    { name: '误纠成别的码字', color: HAMMING_RESULT_COLORS[1], points: counts.map((c) => [c.e, c.miscorrected] as [number, number]) },
    { name: '静默放行', color: HAMMING_RESULT_COLORS[2], points: counts.map((c) => [c.e, c.silent] as [number, number]) },
  ]

  const failed = current.miscorrected > 0
  const readouts: CourseReadout[] = [
    {
      label: '最小距离 d',
      value: String(distance),
      hint: `校验矩阵的 ${n} 列两两不同且没有零列，所以最小重量不超过 ${distance}；重量 ≤ 3 的模式里确实有一个落在零校正子上，d = ${distance} 是枚举出来的。`,
      warn: false,
    },
    {
      label: '可纠位数 t',
      value: String(correctable),
      hint: `理论上 t = ⌊(d−1)/2⌋ = ${correctable}：距离 ${distance} 只能保证纠 ${correctable} 位，再多就分不清是哪个码字出错。`,
      warn: false,
    },
    {
      label: `正确率（e = ${errors}）`,
      value: `${correctRate.toFixed(1)}%`,
      hint: `这一档 ${current.total} 个错误模式：纠回 ${current.corrected}、误纠 ${current.miscorrected}（${miscorrectRate.toFixed(1)}%）、静默放行 ${current.silent}。校正子只有 ${2 ** (n - k)} 种取值，每种对应 ${bucket} 个错误模式。`,
      warn: current.miscorrected > 0,
    },
  ]

  let conclusion: string
  if (errors <= correctable) {
    conclusion =
      errors === 0
        ? `没错的时候原样通过：零校正子这个桶里装着 ${bucket} 个错误模式，只有一个是真的没错（权重 0），其余都是被顺手纠成别的东西的多错。`
        : `${n} 种单错各对应一个非零校正子；加上零校正子一共 ${2 ** (n - k)} 个桶，每个桶装着 2^${k} = ${bucket} 个错误模式。所以「纠 ${correctable} 位」的意思不是多错也能救，而是每个桶里只保证有一个是真该救的。`
  } else if (current.miscorrected > 0 && current.silent === 0) {
    conclusion = `e = ${errors} 的 ${current.total} 个模式一个也没落在零校正子上——距离 ${distance} 的码里不存在距离 ${errors} 的相邻码字，于是它们全被「纠」成别的码字，纠完离原码字还差 ${errors + 1} 位。错 ${correctable} 位能救，错 ${errors} 位会被救到更远的地方去；这时候该做的是检错重传，不是纠错。`
  } else {
    conclusion = `e = ${errors} 时有 ${current.silent} 个模式本身就是合法码字，解码器看不出任何异常；另有 ${current.miscorrected} 个被纠到别的码字上。校正子只能指出「哪个桶」，指不回「几个错」，这就是汉明码的边界。`
  }

  return {
    series,
    xLabel: '错误个数 e',
    yLabel: '错误模式个数',
    stack: true,
    readouts,
    conclusion,
    failed,
    markerX: errors,
    markerLabel: `e = ${errors}`,
    highlightX: errors,
  }
}

/* ---------- 第 1 章：信息量看单次，熵看平均 ---------- */

const INFO_SAMPLES = [1000, 10000, 100000, 200000]
const INFO_SAMPLE_NAMES = ['1 千', '1 万', '10 万', '20 万']
const INFO_SEED = 20261110
/** p 从 0.01 扫到 0.99，每 0.01 一个点。 */
const INFO_POINTS = 99

const infoProbParam: CourseParam = {
  key: 'p',
  label: '事件概率 p',
  min: 0.01,
  max: 0.99,
  step: 0.01,
  unit: '',
}
const infoSampleParam: CourseParam = {
  key: 'sample',
  label: '观测样本数 n',
  min: 0,
  max: 3,
  step: 1,
  unit: '',
  options: [...INFO_SAMPLE_NAMES],
}

/** 本章唯一的错法不是 p 取多少，而是「拿单次信息量当平均」这个口径。 */
const INFO_BASES = ['按概率加权（对）', '拿单次信息量当平均（错）'] as const

const infoBasisParam: CourseParam = {
  key: 'basis',
  label: '计算口径',
  min: 0,
  max: 1,
  step: 1,
  unit: '',
  options: [...INFO_BASES],
}

function log2(x: number): number {
  return Math.log(x) / Math.LN2
}

/** 单次信息量按定义就是 −log2 p，p 越大它越小，p→1 时趋于 0。 */
export function selfInfo(p: number): number {
  return -log2(p)
}

/** 二元信源的熵：平均每次观测给多少比特。 */
export function binaryEntropy(p: number): number {
  return -p * log2(p) - (1 - p) * log2(1 - p)
}

/**
 * 错档里「I(p) 与 H(p) 差多少」的那半句。
 *
 * 这里算出来的数是**比值**、不是差：p > 0.5 时 I/H < 1，「差 0.18 倍」在中文里
 * 读不通（差一倍是差很多，而 0.18 倍其实是「只有它的 18%」）。所以分三种情形写：
 * 比值大于 1 说倍数；小于 1 说百分比并反过来给一个大于 1 的倍数；
 * 恰好相等只发生在 p = 0.5，那一档要说明「错在这一档看不出来」。
 */
export function infoGapText(info: number, entropy: number): string {
  if (Math.abs(info - entropy) < 1e-9) {
    return `两种口径在 p = 0.5 恰好给出同一个数（${info.toFixed(3)} bit），错在这一档看不出来——把 p 拖到 0.01 或 0.99，差别才会露出来`
  }
  if (info > entropy) {
    return `单次信息量是平均的 ${(info / entropy).toFixed(2)} 倍`
  }
  return `单次信息量只有平均的 ${((info / entropy) * 100).toFixed(1)}%，反过来平均是单次的 ${(entropy / info).toFixed(2)} 倍`
}

/** 按 p 抽 n 个 0/1，累计 −log2(抽到那个符号的概率) 再平均；纯抽样，不套公式。 */
function sampleInfo(p: number, n: number): number {
  const rng = createRng(INFO_SEED + n)
  let total = 0
  for (let i = 0; i < n; i += 1) {
    const hit = rng.next() < p
    total += hit ? -log2(p) : -log2(1 - p)
  }
  return total / n
}

function computeInfo(params: Record<string, number>): CourseView {
  const p = Math.min(0.99, Math.max(0.01, Math.round((params.p ?? 0.5) * 100) / 100))
  const sampleIndex = Math.min(INFO_SAMPLES.length - 1, Math.max(0, Math.round(params.sample ?? 3)))
  const n = INFO_SAMPLES[sampleIndex]
  const basis = Math.min(INFO_BASES.length - 1, Math.max(0, Math.round(params.basis ?? 0)))
  const info = selfInfo(p)
  const entropy = binaryEntropy(p)
  // 口径错的时候不去抽样：直接把单次信息量当成平均信息量报上去，差多少倍一眼能看出来。
  const measured = basis === 1 ? info : sampleInfo(p, n)
  const grid = Array.from({ length: INFO_POINTS }, (_, i) => (i + 1) / 100)

  const series: CourseSeries[] = [
    {
      name: '单次信息量 I(p)',
      color: '#7fb3d5',
      points: grid.map((x) => [x, selfInfo(x)] as [number, number]),
    },
    {
      name: '熵 H(p)',
      color: '#5ad1a5',
      points: grid.map((x) => [x, binaryEntropy(x)] as [number, number]),
    },
    {
      name: '当前 p',
      color: '#e0a45c',
      marker: true,
      points: [
        [p, info],
        [p, entropy],
      ],
    },
    {
      name: '当前 p 的竖线',
      color: '#3a5568',
      dashed: true,
      quiet: true,
      points: [
        [p, 0],
        [p, 7.2],
      ],
    },
  ]

  const readouts: CourseReadout[] = [
    {
      label: '单次信息量 I(p)',
      value: `${info.toFixed(2)} bit`,
      hint: `−log2 p = ${info.toFixed(3)}；概率越大，这一次带来的信息越少，p → 1 时趋于 0。这一条是单次的理论值，下一条才是平均。`,
      warn: false,
    },
    {
      label: '熵 H(p)',
      value: `${entropy.toFixed(3)} bit`,
      hint: `−p·log2 p − (1−p)·log2(1−p)；一串观测平均每次给多少，才是熵。`,
      warn: false,
    },
    {
      label: '实测平均信息量',
      value: `${measured.toFixed(3)} bit`,
      hint:
        basis === 1
          ? `这一档把单次信息量 I(p) = ${info.toFixed(3)} bit 直接当成平均信息量报上来，没有按 p 与 1−p 加权；真正的平均是 H(p) = ${entropy.toFixed(3)} bit，${infoGapText(info, entropy)}。`
          : `抽 ${n.toLocaleString('en-US')} 个 0/1 样本，累计 −log2(该符号的概率) 再除以 n；理论上是 H(p) = ${entropy.toFixed(3)} bit，实测与它比 ${(measured / entropy).toFixed(3)} 倍。`,
      warn: basis === 1 || Math.abs(measured - entropy) > 0.05,
    },
  ]

  // 错法只有一处，且不在 p 上：p 是自由参数，任何合法取值都不该判红。
  // 判据挂在「计算口径」上——拿单次信息量当平均，等于假设每个符号都和这一次一样罕见。
  const failed = basis === 1
  let conclusion: string
  if (basis === 1) {
    conclusion = `把单次信息量当平均，等于假设每个符号都同样罕见：I(p) = ${info.toFixed(2)} bit，${infoGapText(info, entropy)}——平均要按 p 与 1−p 加权，不能拿单次顶上。`
  } else if (Math.abs(p - 0.5) < 0.02) {
    conclusion = `两条线都到 ${info.toFixed(2)} bit，这是标尺：一次抛硬币带走的信息量，正好等于整条源的平均。`
  } else if (p > 0.5) {
    conclusion = `一个几乎必然发生的事件，单次只带 ${info.toFixed(2)} bit；可平均仍有 ${entropy.toFixed(3)} bit，因为那 ${Math.round((1 - p) * 100)}% 的「不发生」一次就值 ${(-log2(1 - p)).toFixed(2)} bit——一个事件的信息量，不等于整条源的信息量。`
  } else {
    conclusion = `单次 ${info.toFixed(2)} bit 很值钱，可平均只有 ${entropy.toFixed(3)} bit，它太罕见了，摊到整条源上就只剩这点。`
  }

  return {
    series,
    xLabel: '事件概率 p',
    yLabel: '比特',
    readouts,
    conclusion,
    failed,
    // 刻度按本章的语义定：p 只关心 0.01 与 0.99 两个极端和中间三档，纵轴到 6 bit 一档。
    xTicks: [0.01, 0.25, 0.5, 0.75, 0.99],
    yTicks: [0, 2, 4, 6],
  }
}


/* ---------- 第 3 章：从一条曲线到一个集合 ---------- */

const PROC_KINDS = ['白噪声', '一阶低通（τ = 1 ms）', '非平稳（均值漂移）'] as const
/** 采样率固定 10 kHz：观测时长决定样本数，样本数决定时间平均的涨落。 */
const PROC_FS = 10000
/** 一阶低通的相关时间，固定 1 ms。 */
const PROC_CORR_MS = 1
/** 观测时长的对数档：10 ms 到 1 s。 */
export const PROC_TIMES_MS = [10, 20, 50, 100, 200, 500, 1000] as const
const PROC_TIME_LABELS = PROC_TIMES_MS.map((t) => `${t} ms`)
const PROC_SEED = 20261111
/** 非平稳档的漂移斜率（1/s）：每 100 ms 均值往外漂 0.2。 */
const PROC_DRIFT = 2

const procKindParam: CourseParam = {
  key: 'kind',
  label: '过程类型',
  min: 0,
  max: PROC_KINDS.length - 1,
  step: 1,
  unit: '',
  options: [...PROC_KINDS],
}
const procTimeParam: CourseParam = {
  key: 'timeIndex',
  label: '观测时长 T',
  min: 0,
  max: PROC_TIMES_MS.length - 1,
  step: 1,
  unit: '',
  options: [...PROC_TIME_LABELS],
}
const procCountParam: CourseParam = {
  key: 'k',
  label: '样本条数 K',
  min: 20,
  max: 200,
  step: 10,
  unit: '条',
}

/** AR(1) 的系数 ρ = exp(−1/(τ·fs))：一阶低通里相邻两个采样的相关程度。 */
export function arCoefficient(corrMs: number, fs: number): number {
  return Math.exp(-1 / ((corrMs / 1000) * fs))
}

/**
 * 时间平均的涨落 σ_T：平稳过程的解析值。
 * 白噪声 1/√N；一阶低通 √((1+ρ)/((1−ρ)N))，等价于 √(2τ/T)。
 */
export function processSigmaTheory(kind: number, timeMs: number): number {
  const n = Math.max(1, Math.round((timeMs / 1000) * PROC_FS))
  if (kind === 1) {
    const rho = arCoefficient(PROC_CORR_MS, PROC_FS)
    return Math.sqrt((1 + rho) / (1 - rho) / n)
  }
  return 1 / Math.sqrt(n)
}

export type ProcessStats = {
  /** K 条曲线的时间平均。 */
  averages: number[]
  /** 这 K 个平均值的均值。 */
  mean: number
  /** 这 K 个平均值的标准差，也就是实测的 σ_T。 */
  sigma: number
  /** 落在 ±4σ_T（理论）之外的条数比例。 */
  outside: number
  /** 同样条件下、若过程平稳时的理论 σ_T。 */
  sigmaTheory: number
  /** 容许带的中心：平稳档为 0；非平稳档取末时刻期望 c·T。 */
  center: number
}

/**
 * 跑 K 条曲线：每条各截一段观测，算它自己的时间平均；
 * 再把这 K 个平均值当成一个集合，统计均值、标准差与带外比例。
 */
export function processStats(kind: number, timeMs: number, k: number): ProcessStats {
  const n = Math.max(1, Math.round((timeMs / 1000) * PROC_FS))
  const rng = createRng(PROC_SEED + kind * 977 + Math.round(timeMs) * 13 + k * 7)
  const rho = arCoefficient(PROC_CORR_MS, PROC_FS)
  const drive = Math.sqrt(1 - rho * rho)
  const averages: number[] = []
  for (let c = 0; c < k; c += 1) {
    let acc = 0
    if (kind === 1) {
      // x[n] = ρ·x[n−1] + √(1−ρ²)·w[n]：方差稳在 1，相关时间由 ρ 定。
      let prev = rng.gauss()
      acc += prev
      for (let i = 1; i < n; i += 1) {
        prev = rho * prev + drive * rng.gauss()
        acc += prev
      }
    } else if (kind === 2) {
      // 每条曲线从各自的随机偏置出发，再以固定斜率线性漂移：
      // 集合平均 E[x(t)] = c·t 随时间变，所以它不平稳，时间平均也就不认 0。
      const offset = rng.gauss()
      for (let i = 0; i < n; i += 1) {
        acc += offset + (PROC_DRIFT * i) / PROC_FS + rng.gauss()
      }
    } else {
      for (let i = 0; i < n; i += 1) acc += rng.gauss()
    }
    averages.push(acc / n)
  }
  const mean = averages.reduce((sum, v) => sum + v, 0) / k
  const variance = averages.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, k - 1)
  const sigmaTheory = processSigmaTheory(kind, timeMs)
  // 容许带的中心不能再钉死在 0 上：非平稳档的集合平均 E[x(t)] = c·t 本身就随时间漂，
  // 带心取观测窗口末时刻的期望值 c·T，带外比例量的才是「时间平均跑偏多少」。
  const center = kind === 2 ? (PROC_DRIFT * timeMs) / 1000 : 0
  const outside = averages.filter((v) => Math.abs(v - center) > 4 * sigmaTheory).length / k
  return { averages, mean, sigma: Math.sqrt(variance), outside, sigmaTheory, center }
}

function computeProcess(params: Record<string, number>): CourseView {
  const kind = Math.min(PROC_KINDS.length - 1, Math.max(0, Math.round(params.kind ?? 0)))
  const timeIndex = Math.min(PROC_TIMES_MS.length - 1, Math.max(0, Math.round(params.timeIndex ?? 3)))
  const k = Math.min(200, Math.max(20, Math.round((params.k ?? 100) / 10) * 10))
  const timeMs = PROC_TIMES_MS[timeIndex]
  const stats = processStats(kind, timeMs, k)
  const band = 4 * stats.sigmaTheory
  // 比较基准是同样观测时长下白噪声的 σ_T：低通档「慢多少倍」就是跟它比。
  const whiteSigma = processSigmaTheory(0, timeMs)

  const inBand: Array<[number, number]> = []
  const outBand: Array<[number, number]> = []
  stats.averages.forEach((value, i) => {
    const point: [number, number] = [i + 1, value]
    if (Math.abs(value - stats.center) > band) outBand.push(point)
    else inBand.push(point)
  })

  const series: CourseSeries[] = [
    { name: '带内的时间平均', color: '#5ad1a5', marker: true, points: inBand },
    { name: '带外的时间平均', color: '#e0a45c', marker: true, points: outBand },
  ]

  const failByDrift = kind === 2
  const readouts: CourseReadout[] = [
    {
      label: '理论统计平均',
      value: stats.center === 0 ? '0.000' : stats.center.toFixed(3),
      hint:
        kind === 2
          ? `E[x(t)] = c·t 随时间线性变化，这一档根本没有一个常数均值：容许带中心取观测窗口末时刻的期望值 c·T = ${PROC_DRIFT} × ${(timeMs / 1000).toFixed(3)} s = ${stats.center.toFixed(3)}，也就是这段时间里均值漂到的地方。`
          : '集合平均 E[x(t)]；这一档平稳，E[x(t)] 恒为 0，时间平均该不该收敛到它，正是这一屏要验的事。',
      warn: false,
    },
    {
      label: '时间平均的实测标准差 σ_T',
      value: `${stats.sigma.toFixed(3)}`,
      hint: `把 ${k} 条曲线各自的时间平均当成一个集合算标准差；这一档的解析值是 ${stats.sigmaTheory.toFixed(3)}（同条件下白噪声只有 ${whiteSigma.toFixed(3)}），实测与解析值比 ${(stats.sigma / stats.sigmaTheory).toFixed(2)}。`,
      warn: stats.sigma > stats.sigmaTheory * 3,
    },
    {
      label: '带外比例（±4σ_T 之外）',
      value: `${(stats.outside * 100).toFixed(1)} %`,
      hint: `容许带取 ${stats.center === 0 ? '±4·σ_T' : `以 ${stats.center.toFixed(3)} 为中心、±4·σ_T`} = ${stats.center === 0 ? `±${band.toFixed(3)}` : `${(stats.center - band).toFixed(3)} … ${(stats.center + band).toFixed(3)}`}；比例高说明这些曲线的时间平均根本没围着理论均值转。`,
      warn: stats.outside > 0.5,
    },
  ]

  let conclusion: string
  if (kind === 2) {
    conclusion = `均值在漂的时候，时间平均不再指向同一个常数：理论均值 E[x(t)] = c·t 一路从 0 涨到 ${stats.center.toFixed(3)}，${k} 条曲线各自偏在不同的地方，取末时刻期望作带心后带外比例 ${(stats.outside * 100).toFixed(1)} %。时间平均能当统计平均用，前提是过程平稳；一旦均值在漂，抓一条曲线算出来的东西只属于那一段时间，换一条就不一样了。`
  } else if (kind === 1) {
    conclusion = `相关时间 ${PROC_CORR_MS} ms 的低通过程，${timeMs} ms 里只装得下约 ${Math.round((timeMs / 2) / PROC_CORR_MS)} 个独立样本，σ_T 涨到 ${stats.sigma.toFixed(3)}，是白噪声的 ${(stats.sigma / whiteSigma).toFixed(1)} 倍：相关时间越长，时间平均收敛越慢，一条曲线要观测得更久才顶用。`
  } else {
    conclusion = `白噪声在 ${timeMs} ms 里落进 ${Math.round((timeMs / 1000) * PROC_FS)} 个独立样本，时间平均的标准差是 1/√${Math.round((timeMs / 1000) * PROC_FS)} ≈ ${stats.sigmaTheory.toFixed(3)}；${k} 条曲线的时间平均全挤在 0 附近（带外 ${(stats.outside * 100).toFixed(1)} %），所以抓一条曲线算时间平均，就等于算集合平均——这就是各态历经。`
  }

  return {
    series,
    guides: [
      {
        y: stats.center,
        label: stats.center === 0 ? '统计平均 0' : `统计平均 ${stats.center.toFixed(3)}（末时刻 c·T）`,
      },
      { y: stats.center + band, label: `+4σ_T = ${(stats.center + band).toFixed(3)}` },
      { y: stats.center - band, label: `−4σ_T = ${(stats.center - band).toFixed(3)}` },
    ],
    xLabel: `样本编号（1…${k}）`,
    yLabel: '时间平均',
    readouts,
    conclusion,
    failed: failByDrift && stats.outside > 0.5,
  }
}

/* ---------- 第 4 章：香农公式与带宽的天花板 ---------- */

/** 对数步进的带宽档，每档之间是 2 倍或 2.5 倍，滑杆上按对数均匀分布。 */
export const CHANNEL_BANDS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const
const CHANNEL_BAND_LABELS = CHANNEL_BANDS.map((b) => (b >= 1000 ? '1000 kHz' : `${b} kHz`))
const CHANNEL_POINTS = 121
/** 参考带宽：SNR₀ 是在 1 kHz 下测的，所以 S/N0 的单位是 kHz 乘功率。 */
const CHANNEL_REF_KHZ = 1

const channelSnrParam: CourseParam = {
  key: 'snr0Db',
  label: '参考带宽下的信噪比 SNR₀（1 kHz 下测得）',
  min: 0,
  max: 30,
  step: 1,
  unit: 'dB',
}
const channelBandParam: CourseParam = {
  key: 'bandIndex',
  label: '带宽 B（对数档）',
  min: 0,
  max: CHANNEL_BANDS.length - 1,
  step: 1,
  unit: '',
  options: [...CHANNEL_BAND_LABELS],
}

/** 香农容量 C(B) = B·log2(1 + S/(N0·B))，B 用 kHz，结果换算成 kbit/s。 */
export function channelCapacity(bandKhz: number, snr0Db: number): number {
  const density = 10 ** (snr0Db / 10) * CHANNEL_REF_KHZ
  return bandKhz * Math.log2(1 + density / bandKhz)
}

/** 无限带宽极限 C∞ = S/N0 · log2(e) ≈ 1.4427·S/N0。 */
export function channelLimit(snr0Db: number): number {
  return (10 ** (snr0Db / 10)) * Math.log2(Math.E)
}

function computeChannel(params: Record<string, number>): CourseView {
  const snr0Db = Math.min(30, Math.max(0, Math.round(params.snr0Db ?? 20)))
  const bandIndex = Math.min(CHANNEL_BANDS.length - 1, Math.max(0, Math.round(params.bandIndex ?? 3)))
  const band = CHANNEL_BANDS[bandIndex]
  const limit = channelLimit(snr0Db)

  const curve: Array<[number, number]> = []
  for (let i = 0; i < CHANNEL_POINTS; i += 1) {
    // 横轴按 log10 均匀取点，0.1 kHz 到 1000 kHz 共四个数量级。
    const b = 0.1 * 10 ** ((4 * i) / (CHANNEL_POINTS - 1))
    curve.push([b, channelCapacity(b, snr0Db)])
  }

  const capacity = channelCapacity(band, snr0Db)
  const efficiency = capacity / band
  const share = (capacity / limit) * 100
  const failed = band >= 1000

  const readouts: CourseReadout[] = [
    {
      label: '容量 C（kbit/s）',
      value: `${capacity.toFixed(2)} kbit/s`,
      hint: `理论上 C = B·log2(1 + S/(N0·B))，B = ${band} kHz；SNR₀ = ${snr0Db} dB 折算成 S/N0 = ${(10 ** (snr0Db / 10)).toFixed(0)} kHz。`,
      warn: false,
    },
    {
      label: '频谱效率 C/B（bit/s/Hz）',
      value: `${efficiency.toFixed(3)} bit/s/Hz`,
      hint: '每赫兹每秒搬多少比特；带宽越大，这个数掉得越狠。',
      warn: false,
    },
    {
      label: '占无限带宽极限',
      value: `${share.toFixed(1)} %`,
      hint: `极限 C∞ = 1.4427·S/N0 = ${limit.toFixed(1)} kbit/s；百分比越接近 100%，越说明再宽的带宽也换不来更多容量。`,
      warn: failed,
    },
  ]

  let conclusion: string
  if (failed) {
    conclusion = `带宽不是免费的：SNR₀ 固定时容量有硬天花板 ${limit.toFixed(1)} kbit/s（1.4427·S/N0），再宽的带宽也只是逼近它。想真涨容量，只能提信噪比或者多点几根天线。`
  } else if (band <= 1) {
    conclusion = `1 kHz 下容量 ${capacity.toFixed(2)} kbit/s、频谱效率 ${efficiency.toFixed(2)} bit/s/Hz；把带宽放大一千倍到 1 MHz，容量只到 ${channelCapacity(1000, snr0Db).toFixed(1)} kbit/s，离天花板 ${limit.toFixed(1)} kbit/s 还差一点，频谱效率只剩 ${(channelCapacity(1000, snr0Db) / 1000).toFixed(2)}——宽带宽的每一赫兹都在打折。`
  } else {
    conclusion = `带宽拉到 ${band} kHz，容量 ${capacity.toFixed(1)} kbit/s，只占极限的 ${share.toFixed(1)}%；频谱效率已经掉到 ${efficiency.toFixed(3)} bit/s/Hz。`
  }

  return {
    series: [
      { name: '容量 C(B)', color: '#5ad1a5', points: curve },
      { name: '当前带宽', color: '#e0a45c', marker: true, points: [[band, capacity]] },
    ],
    guides: [{ y: limit, label: `C∞ = ${limit.toFixed(1)} kbit/s：带宽再大也超不过它` }],
    xLabel: '带宽 B（kHz，对数刻度）',
    yLabel: '容量 C（kbit/s）',
    logX: true,
    readouts,
    conclusion,
    failed,
  }
}

/* ---------- 第 13 章：一阶数字锁相环凭什么把相位误差抹平 ---------- */

// 种子写死在文件顶：同一条曲线每次打开都一样，截图和结论才对得上。
const PLL_SEED = 20261112
const PLL_STEPS = 60
const PLL_BAND = 0.02
const PLL_GHOSTS = 40

const pllGainParam: CourseParam = {
  key: 'k',
  label: '环路增益 K',
  min: 0.05,
  max: 2.5,
  step: 0.05,
  unit: '',
}

const pllThetaParam: CourseParam = {
  key: 'theta0',
  label: '初始相位误差 θ₀',
  min: 0.1,
  max: 3,
  step: 0.1,
  unit: '弧度',
}

const pllNoiseParam: CourseParam = {
  key: 'sigma',
  label: '每步相位噪声 σ',
  min: 0,
  max: 0.3,
  step: 0.01,
  unit: '弧度',
}

// 一阶环的全部内容就是这一行：θ(n+1) = θ(n) − K·sin θ(n) + σ·w。
// 不写成小角度近似，也不加阻尼项——「增益决定收敛」这件事就藏在原式的 sin 里。
export function pllStep(theta: number, gain: number, sigma: number, noise: number): number {
  return theta - gain * Math.sin(theta) + sigma * noise
}

/** 跑一条轨迹，返回 n = 0…steps 共 steps+1 个相位误差。 */
export function pllTrace(gain: number, theta0: number, sigma: number, seed: number, steps = PLL_STEPS): number[] {
  const rng = createRng(seed)
  const trace: number[] = [theta0]
  let theta = theta0
  for (let n = 0; n < steps; n += 1) {
    theta = pllStep(theta, gain, sigma, rng.gauss())
    trace.push(theta)
  }
  return trace
}

/** 收敛步数：首次进入 ±0.02 且之后不再离开的那一步；一直没进来就返回 null。 */
export function pllLockStep(trace: number[]): number | null {
  // 停在最后一步不算「进去过」：得留一步在后面确认它真的没再出来。
  for (let i = 1; i < trace.length - 1; i += 1) {
    if (Math.abs(trace[i]) > PLL_BAND) continue
    let stays = true
    for (let j = i + 1; j < trace.length; j += 1) {
      if (Math.abs(trace[j]) > PLL_BAND) {
        stays = false
        break
      }
    }
    if (stays) return i
  }
  return null
}

/** 最后 10 步 |θ| 的平均：这就是「稳态」在屏幕上的样子。 */
/**
 * 理论稳态残余（RMS）。
 *
 * 每步灌 σ 的白噪声、环路以 1−K 的乘数往回拉，稳态方差是 σ² / (2K − K²)，
 * 开方就是 RMS；σ = 0 时当然是 0。K ≥ 2 时环路把误差放大，稳态不存在，返回 null。
 */
export function pllTheoryResidual(gain: number, sigma: number): number | null {
  if (!(gain > 0) || gain >= 2) return null
  if (sigma === 0) return 0
  return sigma / Math.sqrt(2 * gain - gain * gain)
}

/** 理论值的显示口径：0 报 0.000，发散报字符串，其余三位小数。 */
export function pllTheoryText(gain: number, sigma: number): string {
  const theory = pllTheoryResidual(gain, sigma)
  return theory === null ? '发散，无稳态' : theory.toFixed(3)
}

export type PllVerdict = '锁住' | '未收敛' | '残余过大' | '发散'

/**
 * 判定：K ≥ 2 直接判发散；否则看末段——末 10 步平均 |θ| 比前 10 步还在掉超过
 * 15% 就算还没收敛；稳住了再看残余是否落在 max(3×理论, 0.02) 以内。
 */
export function pllVerdict(gain: number, trace: number[], sigma: number): PllVerdict {
  const theory = pllTheoryResidual(gain, sigma)
  if (theory === null) return '发散'
  const tail = pllResidual(trace, 10)
  // 已经在允许带里就别再问「还掉不掉」：K < 1 时误差本来就按 1−K 的乘数一直
  // 指数下降，拿下降率当判据会把已经进带的默认档也判成未收敛。
  if (tail <= Math.max(3 * theory, 0.02)) return '锁住'
  const prev = pllResidual(trace.slice(0, -10), 10)
  return prev > 0 && (prev - tail) / prev > 0.15 ? '未收敛' : '残余过大'
}

export function pllResidual(trace: number[], tail = 10): number {
  const slice = trace.slice(Math.max(0, trace.length - tail))
  return slice.reduce((sum, v) => sum + Math.abs(v), 0) / slice.length
}

function computePll(params: Record<string, number>): CourseView {
  // 三个参数都带默认值：compute({}) 与 compute(defaults) 必须逐字相等。
  // 少了 ?? 就是 NaN，夹紧之后变成 min/max 的怪值，判据还会把环路判成发散——
  // 一个没传参数的调用不该让整页变红。
  const gain = Math.min(pllGainParam.max, Math.max(pllGainParam.min, params.k ?? 0.6))
  const theta0 = Math.min(pllThetaParam.max, Math.max(pllThetaParam.min, params.theta0 ?? 2))
  const sigma = Math.min(pllNoiseParam.max, Math.max(pllNoiseParam.min, params.sigma ?? 0))

  const trace = pllTrace(gain, theta0, sigma, PLL_SEED)
  const lockStep = pllLockStep(trace)
  const residual = pllResidual(trace)
  const multiplier = 1 - gain
  const theoryText = pllTheoryText(gain, sigma)
  const verdict = pllVerdict(gain, trace, sigma)
  const residualBand = Math.max(3 * (pllTheoryResidual(gain, sigma) ?? 0), 0.02)

  // 淡迹线先入数组、主迹线最后画，读数的这一条才压在最上面。
  const series: CourseSeries[] = []
  if (sigma > 0) {
    for (let g = 0; g < PLL_GHOSTS; g += 1) {
      const ghost = pllTrace(gain, theta0, sigma, PLL_SEED + 101 * (g + 1))
      series.push({
        name: '同参数的另一条轨迹',
        color: '#5d7f95',
        quiet: true,
        points: ghost.map((v, n) => [n, v] as [number, number]),
      })
    }
  }
  series.push({
    name: '相位误差 θ(n)',
    color: '#5ad1a5',
    points: trace.map((v, n) => [n, v] as [number, number]),
  })

  const readouts: CourseReadout[] = [
    {
      label: '末段残余（实测 / 理论）',
      value: `${residual.toFixed(3)} / ${theoryText}`,
      hint: '实测取第 51–60 步 |θ| 的平均；理论是噪声下的稳态残余 RMS，不是零——σ = 0 时才是 0.000，σ > 0 时是 σ/√(2K−K²)，K ≥ 2 时环路发散、没有稳态。',
      warn: verdict !== '锁住',
    },
    {
      label: '收敛步数',
      value: lockStep === null ? '—' : `${lockStep}`,
      hint: '首次进入 ±0.02 弧度、并且之后不再离开的那一步；小角度下 θ(n+1) ≈ (1−K)·θ(n)，误差每步乘上 1−K。',
      warn: lockStep === null,
    },
    {
      label: '锁定判定',
      value: verdict,
      hint: `K ≥ 2 直接判发散；否则末 10 步平均 |θ| 比前 10 步还在掉超过 15% 算未收敛；稳住了且不超过 max(3×理论, 0.02) = ${residualBand.toFixed(3)} 算锁住，超了算残余过大。当前 K = ${gain.toFixed(2)}，误差乘数 1−K = ${multiplier.toFixed(2)}。这一屏是一阶数字锁相环的抽象模型：对应教材 13.2 载波同步与 13.3 码元同步里的环路，教材没有同名小节，这里只演示一件事——增益决定收不收敛、噪声决定残余多大。`,
      warn: verdict !== '锁住',
    },
  ]

  let conclusion: string
  if (verdict === '发散') {
    conclusion = `K = ${gain.toFixed(2)} 时 |1−K| = ${Math.abs(multiplier).toFixed(2)} > 1，一阶环把相位误差越放越大：θ 在正负之间来回摆、摆幅还在长，60 步走完根本没进 ±0.02 的判定带。增益越过 2，环路把误差放大而不是抹平，锁相环不是随便给个增益就能锁上——这种参数下连稳态残余都不存在，理论值只能写「发散」。`
  } else if (verdict === '未收敛') {
    conclusion = `K = ${gain.toFixed(2)} 时 |1−K| = ${Math.abs(multiplier).toFixed(2)} < 1，收是收敛的，但每步只抹掉 ${(100 * gain).toFixed(0)}% 的误差，末 10 步平均还在往下掉——60 步后还剩 ${residual.toFixed(3)} 弧度，判定带外。增益太小不是锁不上，是 60 步里来不及锁。`
  } else if (verdict === '残余过大') {
    conclusion = `K = ${gain.toFixed(2)} 时环路是收敛的，但噪声一直灌进来：末 10 步平均残余 ${residual.toFixed(3)} 弧度，超过 max(3×理论 ${theoryText}，0.02) = ${residualBand.toFixed(3)} 的允许带。稳态残余的理论值是 σ/√(2K−K²)，不是零——要压小它，只能减小 σ 或者换更大的 K。`
  } else {
    conclusion = `接收端和解调端各自有一个时钟，相位对不上，判出来的符号就整段错位——所以要先追相位，再谈判决。K = ${gain.toFixed(2)} 时误差乘数 1−K = ${multiplier.toFixed(2)}，θ₀ = ${theta0.toFixed(2)} 弧度在第 ${lockStep} 步就落进 ±0.02，60 步后只剩 ${residual.toFixed(3)}。一阶环的好处就是这个乘数能一眼算出来：|1−K| < 1，也就是 0 < K < 2，才收敛。`
    if (sigma > 0) {
      conclusion += ` 现在叠了 σ = ${sigma.toFixed(2)} 弧度的每步噪声，误差收不到 0，只在 0 附近来回抖——背景那 40 条淡迹线就是同一参数下的另外 40 次实验。`
    }
  }

  return {
    series,
    xLabel: '迭代次数 n',
    yLabel: '相位误差 θ（弧度）',
    guides: [
      { y: PLL_BAND, label: `±${PLL_BAND.toFixed(2)} 弧度：判定带的上下沿` },
      { y: -PLL_BAND, label: '' },
    ],
    readouts,
    conclusion,
    failed: verdict !== '锁住',
  }
}

export const COURSE_CHAPTERS: CourseChapter[] = [
  {
    no: 1,
    title: '绪论',
    implemented: true,
    reason: '',
    question: '一个几乎必然发生的事件，告诉你的信息为什么几乎为零？',
    params: [infoProbParam, infoSampleParam, infoBasisParam],
    defaults: { p: 0.5, sample: 3, basis: 0 },
    failPreset: { p: 0.99, sample: 3, basis: 1 },
    compute: computeInfo,
  },
  {
    no: 2,
    title: '确知信号',
    implemented: true,
    reason: '',
    question: '同一个自相关，为什么能量信号只开一个峰、周期功率信号开一串？',
    params: [tauParam, shapeParam, kindParam],
    defaults: { tau: 1.5, shape: 0, kind: 0 },
    failPreset: { tau: 1.5, shape: 0, kind: 2 },
    compute: computeSignal,
  },
  {
    no: 3,
    title: '随机过程',
    implemented: true,
    reason: '',
    question: '随手抓一条曲线，凭什么代表整个过程？',
    params: [procKindParam, procTimeParam, procCountParam],
    defaults: { kind: 0, timeIndex: 3, k: 100 },
    failPreset: { kind: 2, timeIndex: 3, k: 100 },
    compute: computeProcess,
  },
  {
    no: 4,
    title: '信道',
    implemented: true,
    reason: '',
    labs: [{ label: 'OFDM 实验台', href: '#/ofdm' }],
    question: '带宽翻十倍，信道容量为什么翻不了十倍？',
    params: [channelSnrParam, channelBandParam],
    defaults: { snr0Db: 20, bandIndex: 3 },
    failPreset: { snr0Db: 20, bandIndex: 12 },
    compute: computeChannel,
  },
  {
    no: 5,
    title: '模拟调制系统',
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
    title: '数字基带传输系统',
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
    title: '数字带通传输系统',
    implemented: true,
    reason: '',
    question: '同样的比特率，为什么 2PSK 比 2FSK 少用 3 dB 就能达到同样的误码率？',
    params: [bandSchemeParam, bandEbn0Param, bandPhaseParam],
    defaults: { scheme: 2, ebn0Db: 8, phaseDeg: 0 },
    failPreset: { scheme: 2, ebn0Db: 8, phaseDeg: 45 },
    compute: computeBandpass,
  },
  {
    no: 8,
    title: '新型数字带通调制技术',
    implemented: true,
    question: '同样的带宽，为什么 64QAM 能多传 50% 的比特，却要多花几 dB？',
    reason: '',
    labs: [
      { label: 'QAM 实验台', href: '#/qam' },
      { label: 'OFDM 实验台', href: '#/ofdm' },
    ],
    params: [qamModParam, qamEbn0Param, qamAlphaParam],
    defaults: { mod: 1, ebn0Db: 12, alpha: 0.35 },
    failPreset: { mod: 3, ebn0Db: 12, alpha: 0.35 },
    compute: computeQam,
  },
  {
    no: 9,
    title: '数字信号的最佳接收',
    implemented: true,
    reason: '',
    question: '换一种波形，匹配滤波器的输出信噪比为什么一点不变？',
    params: [matchWaveParam, matchDtParam, matchEbn0Param],
    defaults: { wave: 0, dt: 0, ebn0Db: 8 },
    failPreset: { wave: 0, dt: 0.4, ebn0Db: 8 },
    compute: computeMatch,
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
    implemented: true,
    reason: '',
    labs: [{ label: '卷积码实验台', href: '#/conv' }],
    question: '多传 3 个校验位，为什么只能纠 1 位错？——而且错 2 位比不纠还糟？',
    params: [hamLevelParam, hamErrorsParam],
    defaults: { level: 0, errors: 1 },
    failPreset: { level: 0, errors: 2 },
    compute: computeHamming,
  },
  {
    no: 12,
    title: '正交编码与伪随机序列',
    implemented: true,
    reason: '',
    question: 'm 序列的自相关，为什么只有 1 和 −1/N 两个值？',
    params: [mseqLevelParam, mseqTauParam, mseqTapsParam],
    defaults: { level: 3, tau: 0, taps: 0 },
    failPreset: { level: 3, tau: 0, taps: 1 },
    compute: computeMseq,
  },
  {
    no: 13,
    title: '同步原理',
    implemented: true,
    reason: '',
    question: '相位差着半个符号，环路凭什么自己追上去？',
    params: [pllGainParam, pllThetaParam, pllNoiseParam],
    defaults: { k: 0.6, theta0: 2, sigma: 0 },
    failPreset: { k: 2.4, theta0: 2, sigma: 0 },
    compute: computePll,
  },
]

/** 有深度实验台的章号，页面左树打 ●。 */
export const DEEP_LAB_CHAPTERS = [4, 8, 11]

export function chapterByNo(no: number): CourseChapter | undefined {
  return COURSE_CHAPTERS.find((c) => c.no === no)
}
