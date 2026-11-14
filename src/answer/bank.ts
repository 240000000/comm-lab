import type { AnswerResult } from './provider.ts'
import { chapterByNo } from '../core/course.ts'

/**
 * 内置题库：三题都能离线演示，答案与步骤是硬编码的，
 * 但每个数字都在 tests/answer.test.ts 里用 core 的既有函数复算过。
 */
export type BankProblem = {
  /** 稳定的题目 id，UI 与测试都用它 */
  id: string
  /** 对应课程章节号（1–13） */
  chapter: number
  /** 左栏标题 */
  title: string
  /** 题面原文，也是定位用的文本样本 */
  prompt: string
  /** public/ 下的截图样本，演示时可直接上传 */
  sample: string
  /** 这题用到的公式，答案卡上原样标一行 */
  formula: string
  answer: AnswerResult
}

const capacity: BankProblem = {
  id: 'capacity',
  chapter: 4,
  title: '求信道容量',
  prompt:
    '某恒参信道的带宽为 5 kHz，输出端信噪比 S/N = 30 dB。用香农公式求该信道的容量。',
  sample: 'answer-samples/capacity.png',
  formula: '按香农公式 C = B log₂(1 + S/N)',
  answer: {
    headline: '信道容量 C ≈ 49.8 kbit/s',
    steps: [
      '香农公式：C = B·log₂(1 + S/N)。',
      '代入 B = 5 kHz、S/N = 10^(30/10) = 1000：C = 5·log₂(1 + 1000)。',
      '1 + 1000 = 1001，log₂ 1001 ≈ 9.967。',
      'C ≈ 5 × 9.967 ≈ 49.8 kbit/s，这就是该信道无差错传输的上限。',
    ],
    params: [
      { key: 'bandKhz', label: '带宽 B（kHz）', value: 5 },
      { key: 'snDb', label: '信噪比 S/N（dB）', value: 30 },
      { key: 'capacityKbit', label: '容量 C（kbit/s）', value: 49.8 },
    ],
    // 右栏第 4 章的默认档是 37 dB / 5 kHz，这里把同一组题设带过去
    preset: { no: 4, values: { bandIndex: 5, snr0Db: 36.9897 } },
    caveat: '这里 30 dB 指信道输出端的功率信噪比 S/N（即 1000 倍）；若题面给的是 N₀ 或每赫兹信噪比，先换算再代入。',
  },
}

/**
 * 同一道题的另一张图：带宽 3 kHz、S/N 30 dB。
 * 3 kHz 不在实验台的带宽档位里（档位是 2 / 5 kHz），所以这题故意不带 preset，
 * 右栏照常打开默认档，左栏明说「题设 3 kHz 不在本屏档位（最近 2 / 5 kHz）」。
 */
const capacity3k: BankProblem = {
  id: 'capacity-3k',
  chapter: 4,
  title: '求信道容量（3 kHz 版）',
  prompt:
    '某恒参信道的带宽为 3 kHz，输出端信噪比 S/N = 30 dB。用香农公式求该信道的容量。',
  sample: 'answer-samples/capacity-3k.png',
  formula: '按香农公式 C = B log₂(1 + S/N)',
  answer: {
    headline: '信道容量 C ≈ 29.9 kbit/s',
    steps: [
      '香农公式：C = B·log₂(1 + S/N)。',
      '代入 B = 3 kHz、S/N = 10^(30/10) = 1000：C = 3·log₂(1 + 1000)。',
      '1 + 1000 = 1001，log₂ 1001 ≈ 9.967。',
      'C ≈ 3 × 9.967 ≈ 29.9 kbit/s。',
    ],
    params: [
      { key: 'bandKhz', label: '带宽 B（kHz）', value: 3 },
      { key: 'snDb', label: '信噪比 S/N（dB）', value: 30 },
      { key: 'capacityKbit', label: '容量 C（kbit/s）', value: 29.9 },
    ],
    caveat: '3 kHz 不在实验台的带宽档位里（档位是 2 / 5 kHz），所以右栏只能开默认档——读数不会和这题对上，这是对的，不是坏了。',
  },
}

const pskEbn0: BankProblem = {
  id: 'psk-ebn0',
  chapter: 7,
  title: '求 2PSK 所需的 Eb/N₀',
  prompt:
    '2PSK 相干解调系统要求误码率不超过 10⁻⁵。求带通系统所需的最小 Eb/N₀（用 dB 表示）。',
  sample: 'answer-samples/psk-ebn0.png',
  formula: '2PSK 相干解调 P_b = Q(√(2·Eb/N₀))',
  answer: {
    headline: '所需 Eb/N₀ ≈ 9.59 dB（约 9.10 倍）',
    steps: [
      '2PSK 相干解调的误码率：P_b = Q(√(2·Eb/N₀))。',
      '要求 P_b = 10⁻⁵，查 Q 函数反函数得 √(2·Eb/N₀) ≈ 4.2649。',
      '平方：2·Eb/N₀ ≈ 18.19，故 Eb/N₀ ≈ 9.10。',
      '换成对数：10·lg(9.10) ≈ 9.59 dB。',
    ],
    params: [
      { key: 'targetBer', label: '目标误码率', value: 1e-5 },
      { key: 'ebn0Linear', label: 'Eb/N₀（倍）', value: 9.1 },
      { key: 'ebn0Db', label: 'Eb/N₀（dB）', value: 9.59 },
    ],
    preset: { no: 7, values: { ebn0Db: 10 } },
    caveat: '这是理想相干解调的理论值，实际系统还要留 1–2 dB 的实现损耗。',
  },
}

const mseqPeriod: BankProblem = {
  id: 'mseq-period',
  chapter: 12,
  title: '求 m 序列周期',
  prompt:
    '由 4 级移位寄存器产生的 m 序列，反馈抽头取本原多项式对应位置。求一个周期内的码元个数 N。',
  sample: 'answer-samples/mseq-period.png',
  formula: '本原抽头 m 序列周期 N = 2ⁿ − 1',
  answer: {
    headline: '周期 N = 15',
    steps: [
      'n 级移位寄存器的 m 序列周期由本原多项式决定：N = 2ⁿ − 1。',
      '本题 n = 4，故 N = 2⁴ − 1 = 16 − 1 = 15。',
      '若抽头取的不是本原多项式，周期会退化为 2ⁿ − 1 的某个真因子，最长也达不到 15。',
      '第 12 章的「m 序列周期」实验台可直接切 n = 4 核对：周期读数 15、非本原抽头会给出警告。',
    ],
    params: [
      { key: 'stages', label: '寄存器级数 n', value: 4 },
      { key: 'period', label: '周期 N', value: 15 },
    ],
    preset: { no: 12, values: { level: 0, taps: 0 } },
  },
}

export const ANSWER_BANK: BankProblem[] = [capacity, capacity3k, pskEbn0, mseqPeriod]

/** 按章节号找内置题；没有就用 undefined，让 UI 只显示定位结果。 */
export function problemByChapter(chapter: number): BankProblem | undefined {
  return ANSWER_BANK.find((item) => item.chapter === chapter)
}

export function problemById(id: string): BankProblem | undefined {
  return ANSWER_BANK.find((item) => item.id === id)
}

/**
 * 第 4 章有两道题（5 kHz 与 3 kHz），章节号分不开。
 * 从题面里抓带宽数字再挑——抓不到就退回该章第一道，绝不猜别的章。
 */
export function pickProblem(text: string, chapter: number): BankProblem | undefined {
  const candidates = ANSWER_BANK.filter((item) => item.chapter === chapter)
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  // 同一章放着好几道题时，必须靠题面里的带宽对上号；抓不到就返回 undefined，
  // 不拿「该章第一道」顶上——那只是猜，算出来的数会悄悄错掉。
  const bandText = /(\d+(?:\.\d+)?)\s*kHz/i.exec(text)
  if (!bandText) return undefined
  const bandKhz = Number(bandText[1])
  const snrText = /S\s*\/\s*N\D{0,6}(\d+(?:\.\d+)?)\s*dB/i.exec(text)
  const snDb = snrText ? Number(snrText[1]) : null

  return candidates.find((item) => {
    const band = item.answer.params.find((param) => param.key === 'bandKhz')
    if (!band || band.value !== bandKhz) return false
    const snr = item.answer.params.find((param) => param.key === 'snDb')
    if (snDb !== null && snr && snr.value !== snDb) return false
    return true
  })
}

/** 卡片 1 顶部的常驻提示：离线时只认内置三题，接上端点后才什么题都能解。 */
export const OFFLINE_ONLY_HINT =
  '离线模式只认内置的三道示例题；接上端点后可以解任意题，图直接交给模型看。'

/** A 态：没定位到章节。 */
export const NO_CHAPTER_HINT =
  '没认出这是哪一章。可以手动选一章，或换一张更清晰的截图。'

/** B 态：定位到第 N 章，但题库里没有这道题。 */
export const NO_SAMPLE_HINT_OFFLINE =
  '这道题不在内置的三道示例里。离线模式只能演示这三道；配置端点后可用模型解任意题。'

export const NO_SAMPLE_HINT_WIRED =
  '这道题没匹配到内置示例。模型已经接上了，换一张更清楚的截图再让它看一次。'

export function noSampleHint(wired: boolean): string {
  return wired ? NO_SAMPLE_HINT_WIRED : NO_SAMPLE_HINT_OFFLINE
}

/** C 态：模型调用失败时的收尾建议。 */
export const MODEL_ERROR_TAIL = '可以先用内置三道示例题。'

/** 章节标题，给左栏与 iframe 上方的小标题用。 */
export function chapterTitle(chapter: number): string {
  return chapterByNo(chapter)?.title ?? `第 ${chapter} 章`
}