/**
 * 任务模式里「自己出题」的生成、判分与本地存档。
 *
 * 和 missions.ts 的固定五题不同，这里的参数由用户自己挑：阶数、信噪比、样本量。
 * 三条硬约束：
 *
 * 1. 标准答案必须现算。同一组参数永远走同一条噪声流（固定种子 + 按信噪比派生），
 *    所以同一组参数生成两次，答案逐位相同；换参数，答案就跟着变。
 * 2. 样本量按**比特**算。仿真按符号跑，最后一个符号只数前 r 位，
 *    这样分母严格等于用户填的比特数，不会多算一个符号尾巴。
 * 3. 存取是纯函数，storage 由调用方传进来。测试里塞一个假 storage 就能把
 *    「保存 / 刷新 / 删除 / 坏数据」四种情形跑完，不需要浏览器。
 */
import { addNoise, decide, noiseSigma } from './channel.ts'
import { deriveSeed } from './metrics.ts'
import { QAM_ORDERS, bitsPerSymbol, buildConstellation, orderLabel } from './qam.ts'
import { createRng } from './rng.ts'

/** 出题用的固定种子：与 QAM 页、固定数值题同一条噪声流。 */
export const CUSTOM_SEED = 20261027

export const CUSTOM_MIN_SNR_DB = 0
export const CUSTOM_MAX_SNR_DB = 20
export const CUSTOM_MAX_BITS = 200000
export const CUSTOM_DEFAULT_BITS = 20000

/** 判分容差：真值大于 0 时取相对 10% 与绝对 1e-5 里更宽的那个。 */
export const CUSTOM_RELATIVE_TOLERANCE = 0.1
export const CUSTOM_ABSOLUTE_TOLERANCE = 1e-5

/** 本地存档的键名。改名字等于让旧记录失效，别随手改。 */
export const CUSTOM_STORAGE_KEY = 'comm-lab.custom-questions.v1'

export type CustomParams = {
  order: number
  snrDb: number
  sampleBits: number
}

export type CustomQuestion = {
  order: number
  label: string
  snrDb: number
  sampleBits: number
  /** 为了数满这些比特，实际跑了多少个符号（向上取整）。 */
  symbolCount: number
  bitsPerSymbol: number
  seedUsed: number
  bitErrors: number
  symbolErrors: number
  bitCount: number
  ber: number
  ser: number
}

export type ParamError = {
  ok: false
  field: 'order' | 'snrDb' | 'sampleBits'
  message: string
}

export type ParamCheck = { ok: true } | ParamError

export type CreateResult = { ok: true; question: CustomQuestion } | ParamError

/** 哪一档阶数是合法的。非法值直接报错，不回退成 16QAM。 */
function isSupportedOrder(order: number): boolean {
  return (QAM_ORDERS as readonly number[]).includes(order)
}

/**
 * 参数校验。顺序固定：先阶数、再信噪比、最后样本量。
 * 一次只报第一个错，界面上错误文字就贴着对应输入框。
 */
export function validateCustomParams(params: Partial<CustomParams>): ParamCheck {
  const { order, snrDb, sampleBits } = params

  if (typeof order !== 'number' || !Number.isFinite(order) || !isSupportedOrder(order)) {
    return {
      ok: false,
      field: 'order',
      message: `阶数只支持 BPSK（2）、QPSK（4）、16QAM（16）、64QAM（64）四档，${String(order)} 不在里面。`,
    }
  }

  if (typeof snrDb !== 'number' || !Number.isFinite(snrDb)) {
    return { ok: false, field: 'snrDb', message: '信噪比要填一个数字（0–20 dB）。' }
  }
  if (snrDb < CUSTOM_MIN_SNR_DB || snrDb > CUSTOM_MAX_SNR_DB) {
    return {
      ok: false,
      field: 'snrDb',
      message: `信噪比要落在 0–20 dB 之间，${snrDb} dB 超出范围。`,
    }
  }

  if (typeof sampleBits !== 'number' || !Number.isFinite(sampleBits)) {
    return { ok: false, field: 'sampleBits', message: '样本量要填 1–200,000 之间的整数（按比特算）。' }
  }
  if (!Number.isInteger(sampleBits)) {
    return { ok: false, field: 'sampleBits', message: `样本量要是整数个比特，${sampleBits} 不是。` }
  }
  if (sampleBits < 1) {
    return {
      ok: false,
      field: 'sampleBits',
      message: `${sampleBits} 个比特统计不出误码率，至少填 1。`,
    }
  }
  if (sampleBits > CUSTOM_MAX_BITS) {
    return {
      ok: false,
      field: 'sampleBits',
      message: `样本量最多 ${CUSTOM_MAX_BITS.toLocaleString('en-US')} 比特，${sampleBits} 超了。`,
    }
  }

  return { ok: true }
}

/** 按比特截断的一次仿真：返回误码、误符号与分母。 */
function simulateBits(params: CustomParams): {
  symbolCount: number
  bitsPerSymbol: number
  seedUsed: number
  bitErrors: number
  symbolErrors: number
  bitCount: number
  ber: number
  ser: number
} {
  const { order, snrDb, sampleBits } = params
  const points = buildConstellation(order)
  const perSymbol = bitsPerSymbol(order)
  const symbolCount = Math.ceil(sampleBits / perSymbol)
  const seedUsed = deriveSeed(CUSTOM_SEED, snrDb)
  const rng = createRng(seedUsed)
  const sigma = noiseSigma(snrDb)

  let bitErrors = 0
  let symbolErrors = 0

  for (let index = 0; index < symbolCount; index += 1) {
    const sentIndex = Math.floor(rng.next() * points.length)
    const sent = points[sentIndex]
    const received = addNoise(sent, sigma, rng)
    const decidedIndex = decide(received.i, received.q, points)

    if (decidedIndex !== sentIndex) {
      symbolErrors += 1
      const decided = points[decidedIndex]
      // 最后一个符号可能只取一部分比特，超出 sampleBits 的尾巴不能算进分母。
      const limit = Math.min(perSymbol, sampleBits - index * perSymbol)
      for (let bit = 0; bit < limit; bit += 1) {
        if (sent.bits[bit] !== decided.bits[bit]) bitErrors += 1
      }
    }
  }

  return {
    symbolCount,
    bitsPerSymbol: perSymbol,
    seedUsed,
    bitErrors,
    symbolErrors,
    bitCount: sampleBits,
    ber: bitErrors / sampleBits,
    ser: symbolErrors / symbolCount,
  }
}

/** 生成一道题：参数合法才跑仿真，答案每次都现算，没有缓存表。 */
export function createCustomQuestion(params: Partial<CustomParams>): CreateResult {
  const check = validateCustomParams(params)
  if (!check.ok) return check

  const { order, snrDb, sampleBits } = params as CustomParams
  const stats = simulateBits({ order, snrDb, sampleBits })
  return {
    ok: true,
    question: {
      order,
      label: orderLabel(order),
      snrDb,
      sampleBits,
      ...stats,
    },
  }
}

export type CustomGrade = {
  correct: boolean
  /** 解析出来的用户答案；没填或不是数字时为 null。 */
  parsed: number | null
  truth: number
  /** 真值大于 0 时的允许偏差；真值为 0 时为 0（只认 0）。 */
  tolerance: number
  low: number
  high: number
  reason: string
}

/** 把误码率写成页面上的样子：0 就写 0，其余保留四位有效数字的科学计数法。 */
export function formatBer(value: number): string {
  if (value === 0) return '0'
  return value.toExponential(3)
}

function parseAnswer(answer: string | number | null): number | null {
  if (answer === null) return null
  if (typeof answer === 'number') return Number.isFinite(answer) ? answer : null
  const text = answer.trim()
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * 判分。
 *
 * 容差分两种情形，不写成一条公式：
 * - 真值 > 0：|答案 − 真值| ≤ max(真值 × 10%, 1e-5)；
 * - 真值 = 0：只认 0。高信噪比下一次错都没有时，答案就该是 0，
 *   不能因为「1e-5 也在绝对底以内」把别的数算对。
 */
export function gradeCustomAnswer(
  question: CustomQuestion,
  answer: string | number | null,
): CustomGrade {
  const truth = question.ber
  const empty: CustomGrade = {
    correct: false,
    parsed: null,
    truth,
    tolerance: 0,
    low: truth,
    high: truth,
    reason: '还没填答案。',
  }

  if (answer === null || (typeof answer === 'string' && answer.trim() === '')) return empty

  const parsed = parseAnswer(answer)
  if (parsed === null) {
    return { ...empty, reason: '填一个数字，科学计数法也可以（比如 2.9e-2）。' }
  }
  if (parsed < 0) {
    return { ...empty, parsed, reason: '误码率不会是负数。' }
  }

  if (truth === 0) {
    const correct = parsed === 0
    return {
      correct,
      parsed,
      truth,
      tolerance: 0,
      low: 0,
      high: 0,
      reason: correct
        ? '对：这次仿真一个比特都没错，答案就是 0。'
        : `不对：这次仿真一个比特都没错，答案就是 0，你填的是 ${formatBer(parsed)}。`,
    }
  }

  const tolerance = Math.max(truth * CUSTOM_RELATIVE_TOLERANCE, CUSTOM_ABSOLUTE_TOLERANCE)
  const low = truth - tolerance
  const high = truth + tolerance
  const correct = Math.abs(parsed - truth) <= tolerance
  const detail = `仿真答案 ${formatBer(truth)}（错 ${question.bitErrors.toLocaleString('en-US')} 比特，共 ${question.bitCount.toLocaleString('en-US')} 比特）`

  return {
    correct,
    parsed,
    truth,
    tolerance,
    low,
    high,
    reason: correct
      ? `对：${detail}，容差 ±${formatBer(tolerance)}。`
      : `不对：${detail}，允许区间 ${formatBer(low)} – ${formatBer(high)}。`,
  }
}

export type SavedQuestion = {
  id: string
  savedAt: string
  order: number
  snrDb: number
  sampleBits: number
  seedUsed: number
  bitErrors: number
  bitCount: number
  truth: number
  given: number
  correct: boolean
}

/** 浏览器 localStorage 的最小接口，测试里用假对象替。 */
export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LoadResult = {
  items: SavedQuestion[]
  /** 读失败或跳过坏记录时的提示；正常为 null。 */
  error: string | null
}

function isSavedQuestion(value: unknown): value is SavedQuestion {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.savedAt === 'string' &&
    typeof record.order === 'number' &&
    isSupportedOrder(record.order) &&
    typeof record.snrDb === 'number' &&
    Number.isFinite(record.snrDb) &&
    typeof record.sampleBits === 'number' &&
    Number.isInteger(record.sampleBits) &&
    record.sampleBits >= 1 &&
    typeof record.seedUsed === 'number' &&
    Number.isInteger(record.seedUsed) &&
    typeof record.bitErrors === 'number' &&
    Number.isFinite(record.bitErrors) &&
    typeof record.bitCount === 'number' &&
    record.bitCount >= 1 &&
    typeof record.truth === 'number' &&
    Number.isFinite(record.truth) &&
    typeof record.given === 'number' &&
    Number.isFinite(record.given) &&
    typeof record.correct === 'boolean'
  )
}

/** 读存档：坏 JSON 不抛错，坏记录跳过并说明跳了几条。 */
export function loadSavedQuestions(storage: StorageLike): LoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(CUSTOM_STORAGE_KEY)
  } catch {
    return { items: [], error: '本地记录读不出来，已忽略。' }
  }
  if (raw === null) return { items: [], error: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { items: [], error: '本地记录读不出来，已忽略。' }
  }
  if (!Array.isArray(parsed)) {
    return { items: [], error: '本地记录读不出来，已忽略。' }
  }

  const items = parsed.filter(isSavedQuestion)
  const dropped = parsed.length - items.length
  return {
    items,
    error: dropped > 0 ? `本地记录里有 ${dropped} 条读不出来，已跳过。` : null,
  }
}

/** 存一道题：新记录放最前面；写失败时原列表不动，并给出提示。 */
export function saveSavedQuestion(
  storage: StorageLike,
  record: SavedQuestion,
): LoadResult & { ok: boolean } {
  const loaded = loadSavedQuestions(storage)
  const items = [record, ...loaded.items]
  try {
    storage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(items))
    return { ok: true, items, error: loaded.error }
  } catch {
    return {
      ok: false,
      items: loaded.items,
      error: '浏览器不让写了（可能是隐私模式或存储满了），这道题没存上。',
    }
  }
}

/** 删一道题；删完写回，刷新后就不会再出现。 */
export function removeSavedQuestion(
  storage: StorageLike,
  id: string,
): LoadResult & { ok: boolean } {
  const loaded = loadSavedQuestions(storage)
  const items = loaded.items.filter((item) => item.id !== id)
  try {
    storage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(items))
    return { ok: true, items, error: null }
  } catch {
    return { ok: false, items: loaded.items, error: '浏览器不让写了，这道题没删掉。' }
  }
}

/** 从一道题和一次判分拼出存档记录。ID 与时间由调用方给，方便测试。 */
export function createSavedRecord(
  question: CustomQuestion,
  given: number,
  correct: boolean,
  savedAt: string,
  id: string,
): SavedQuestion {
  return {
    id,
    savedAt,
    order: question.order,
    snrDb: question.snrDb,
    sampleBits: question.sampleBits,
    seedUsed: question.seedUsed,
    bitErrors: question.bitErrors,
    bitCount: question.bitCount,
    truth: question.ber,
    given,
    correct,
  }
}
