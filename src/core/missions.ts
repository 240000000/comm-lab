/**
 * 任务模式的题库与判分。
 *
 * 两条硬约束：
 * 1. 五道题的期望值全部由仿真函数现算，不手抄——代码一改，期望值跟着改，
 *    不会出现「页面上的答案还是老的」这种悄悄失配；
 * 2. 判分是纯函数，输进答案、吐出对错与理由，题库本身是纯数据。
 *
 * 每道题的答案都能在前三个实验台里亲手复现，题面里写清了去哪一页、怎么摆参数。
 */
import { createRng } from './rng.ts'
import { simulateAwgn } from './metrics.ts'
import { runOfdm } from './ofdm.ts'
import { decodeHard, encodeConvolutional, transmit } from './conv.ts'

export type MissionKind = 'numeric' | 'phenomenon' | 'ability' | 'concept' | 'selection'

export type MissionAnswer = string | number

export type Mission = {
  id: string
  kind: MissionKind
  /** 题面。 */
  question: string
  /** 去哪儿复现，写清页面与参数。 */
  evidence: string
  /** 数值题容差（相对误差），其他题为 undefined。 */
  tolerance?: number
  /** 选项题的候选项。 */
  options?: string[]
  /** 由仿真算出来的期望值。 */
  expected: MissionAnswer
}

export type MissionGrade = {
  id: string
  kind: MissionKind
  correct: boolean
  expected: MissionAnswer
  given: MissionAnswer | null
  /** 判分理由，答错时用来解释差在哪。 */
  reason: string
}

/** 数值题的仿真参数：与 QAM 页默认值一致（16QAM、12 dB、两个符号点）。 */
export const NUMERIC_SEED = 20261027
export const NUMERIC_SYMBOLS = 20000
export const NUMERIC_SNR_DB = 12
export const NUMERIC_TOLERANCE = 0.1

/** 现象题的仿真参数：与 OFDM 页「CP 16、延时 21」一致。 */
export const PHENOMENON_CP = 16
export const PHENOMENON_DELAY = 21

/** 能力题：与卷积码页默认参数一致，翻第 13–16 位（从 1 数起）。 */
export const ABILITY_BITS = 12
export const ABILITY_FLIPS = [12, 13, 14, 15]
export const ABILITY_SEED = 20261027

/** 数值题期望值：16QAM、12 dB、20,000 个符号下的误码率。 */
export function numericBer(): number {
  return simulateAwgn({
    order: 16,
    snrDb: NUMERIC_SNR_DB,
    symbolCount: NUMERIC_SYMBOLS,
    seed: NUMERIC_SEED,
    keepSamples: false,
  }).ber
}

/** 现象题期望值：CP 16、延时 21 时，压进数据段的采样个数。 */
export function phenomenonIntrusion(): number {
  return runOfdm({
    cpLen: PHENOMENON_CP,
    delay: PHENOMENON_DELAY,
    symbolCount: 4,
    seed: ABILITY_SEED,
  }).wave.intrudingSamples
}

/** 能力题的比特序列：与卷积码页默认序列同一条（同一个种子、同一个抽法）。 */
export function abilityBits(): number[] {
  const rng = createRng(ABILITY_SEED)
  const bits: number[] = []
  for (let i = 0; i < ABILITY_BITS; i += 1) bits.push(rng.next() > 0.5 ? 1 : 0)
  return bits
}

/** 能力题期望值：翻四位之后硬判决译码，还剩几位错。 */
export function abilityRemainingErrors(): number {
  const bits = abilityBits()
  const encoded = encodeConvolutional(bits)
  // 关噪声（sigma = 0），只让手动翻的那四位去考译码器。
  const received = transmit(encoded.coded, 0, createRng(ABILITY_SEED)).map((value, index) =>
    ABILITY_FLIPS.includes(index) ? -value : value,
  )
  const decoded = decodeHard(received.map((value) => (value > 0 ? 1 : 0)))
  let errors = 0
  for (let i = 0; i < bits.length; i += 1) {
    if (decoded[i] !== bits[i]) errors += 1
  }
  return errors
}

/** 概念题与选型题的期望值：都是定论，写在数据里，测试里也断言一遍。 */
export const CONCEPT_EXPECTED = '不能'
export const SELECTION_EXPECTED = '不行'

/** 五道题：纯数据，页面与测试读同一份。 */
export const MISSIONS: Mission[] = [
  {
    id: 'numeric',
    kind: 'numeric',
    question: '16QAM，Es/N0 拖到 12 dB，统计 20,000 个符号，误码率大概是多少？（容差 ±10%）',
    evidence: 'QAM 页 → 信噪比拖到 12.0 dB、种子 20261027，读「误码率 BER」那个数。',
    tolerance: NUMERIC_TOLERANCE,
    expected: numericBer(),
  },
  {
    id: 'phenomenon',
    kind: 'phenomenon',
    question: 'CP 设 16、延时径拖到 21，有多少个采样被拖尾压进了数据段？',
    evidence: 'OFDM 页 → 循环前缀 16、延时 21，看时域图右上角那句「拖尾压进数据段 N 个采样」。',
    expected: phenomenonIntrusion(),
  },
  {
    id: 'ability',
    kind: 'ability',
    question: '12 位信息位编成 28 位码字，关掉噪声、在第 13–16 位翻了四个比特，硬判决译码之后还剩几位错？',
    evidence: '卷积码页 → 关噪声、手动翻位选「翻一片 4 位」，看状态条里「还有 N 位没纠回来」。',
    expected: abilityRemainingErrors(),
  },
  {
    id: 'concept',
    kind: 'concept',
    question: '加了循环前缀，能不能消除频域衰落？',
    evidence: 'OFDM 页说明卡：CP 消掉的是码间干扰，信道的频率选择性还在。',
    options: ['能', '不能'],
    expected: CONCEPT_EXPECTED,
  },
  {
    id: 'selection',
    kind: 'selection',
    question: '在 12 dB 下想把误码率压到 1e-4，只调 16QAM 的参数行不行？',
    evidence: 'QAM 页下方 0–20 dB 曲线：12 dB 的实测点在 1e-2 量级，离 1e-4 差两个数量级。',
    options: ['行', '不行'],
    expected: SELECTION_EXPECTED,
  },
]

/** 把一道题的作答判成对错。空答案一律判错，且给出「还没填」的理由。 */
export function gradeMission(mission: Mission, answer: MissionAnswer | null): MissionGrade {
  const base = { id: mission.id, kind: mission.kind, expected: mission.expected, given: answer }

  if (answer === null || answer === '' || (typeof answer === 'number' && !Number.isFinite(answer))) {
    return { ...base, correct: false, reason: '这一题还没填。' }
  }

  if (mission.kind === 'numeric') {
    const value = typeof answer === 'number' ? answer : Number(answer)
    if (!Number.isFinite(value)) {
      return { ...base, correct: false, reason: '填一个数字，科学计数法也可以（比如 2.9e-2）。' }
    }
    const expected = mission.expected as number
    const tolerance = mission.tolerance ?? 0
    const low = expected * (1 - tolerance)
    const high = expected * (1 + tolerance)
    const correct = value >= low && value <= high
    return {
      ...base,
      correct,
      reason: correct
        ? `落在容差内：期望约 ${expected.toExponential(3)}，容差 ±${Math.round(tolerance * 100)}%。`
        : `差得有点多：期望约 ${expected.toExponential(3)}，容差区间 ${low.toExponential(3)} – ${high.toExponential(3)}。回 QAM 页，把信噪比拖到 12 dB 再看一眼。`,
    }
  }

  if (mission.kind === 'phenomenon' || mission.kind === 'ability') {
    const value = typeof answer === 'number' ? answer : Number(answer)
    const expected = mission.expected as number
    const correct = value === expected
    return {
      ...base,
      correct,
      reason: correct
        ? `对：${expected} 个。`
        : `不对：期望是 ${expected} 个。${mission.id === 'phenomenon' ? '延时减去 CP 长度就是压进来的采样数。' : '翻在同一个约束窗口里，译码器会把它们当成另一条合法路径。'}`,
    }
  }

  const correct = String(answer) === String(mission.expected)
  return {
    ...base,
    correct,
    reason: correct ? `对：${String(mission.expected)}。` : `不对：这题的答案是「${String(mission.expected)}」。${mission.id === 'concept' ? 'CP 只把码间干扰挡在窗外，信道的频率选择性要靠均衡。' : '12 dB 下 16QAM 的误码率在 1e-2 量级，离 1e-4 差两个数量级，得提高信噪比或者加编码。'}`,
  }
}

/** 一次判全部五道题。 */
export function gradeMissions(answers: Record<string, MissionAnswer | null>): MissionGrade[] {
  return MISSIONS.map((mission) => gradeMission(mission, answers[mission.id] ?? null))
}

/** 计分：答对几道。全对五比五，全错零比五。 */
export function scoreMissions(grades: MissionGrade[]): { correct: number; total: number; allCorrect: boolean } {
  const correct = grades.filter((grade) => grade.correct).length
  return { correct, total: grades.length, allCorrect: correct === grades.length }
}
