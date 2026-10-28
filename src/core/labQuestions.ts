/**
 * 任务模式「你自己出题」的三类题型：QAM、卷积码、OFDM。
 *
 * 这里只做三件事：
 *   1. 把用户挑的参数交给现成的仿真函数，现算标准答案（不手抄、不联网）；
 *   2. 把题型、参数、答案打包成能被页面回填的查询串；
 *   3. 读写本地存档，旧版只有 QAM 字段的记录按 QAM 读。
 *
 * 仿真算式全部留在各自的 core 模块里，这个文件一行都没重写。
 */
import {
  CUSTOM_SEED,
  CUSTOM_STORAGE_KEY,
  CUSTOM_ABSOLUTE_TOLERANCE,
  CUSTOM_RELATIVE_TOLERANCE,
  createCustomQuestion,
  formatBer,
  type CustomQuestion,
  type StorageLike,
} from './customQuestion.ts'
import { MAX_CP, MAX_DELAY, SUBCARRIERS, runOfdm } from './ofdm.ts'
import { decodeHard, encodeConvolutional, sliceHard, transmit } from './conv.ts'
import { createRng } from './rng.ts'
import { deriveSeed } from './metrics.ts'
import { QAM_ORDERS, bitsPerSymbol, orderLabel } from './qam.ts'

export type QuestionKind = 'qam' | 'conv' | 'ofdm'

export type QamParams = { order: number; snrDb: number; sampleBits: number }
export type ConvParams = { ebN0: number; infoBits: number; noise: boolean }
export type OfdmParams = { cpLen: number; delay: number; symbolCount: number }

export type QuestionParams = QamParams | ConvParams | OfdmParams

export type LabQuestion = {
  kind: QuestionKind
  params: QuestionParams
  /** 题面整句，页面直接显示。 */
  prompt: string
  /** 「16QAM · 12 dB · 1,000 比特」这种一行摘要，存档列表也用。 */
  summary: string
  answerKind: 'rate' | 'count'
  errors: number
  total: number
  truth: number
  seedUsed: number
}

export type LabGrade = {
  parsed: number | null
  correct: boolean
  reason: string
}

export type QuestionError = { ok: false; message: string }
export type QuestionResult = { ok: true; question: LabQuestion } | QuestionError

export const CONV_MAX_INFO_BITS = 12
export const CONV_MIN_EBN0 = 0
export const CONV_MAX_EBN0 = 8
export const OFDM_MIN_SYMBOLS = 1
export const OFDM_MAX_SYMBOLS = 500

const numberText = (value: number) => value.toLocaleString('en-US')

/** 卷积码：信息比特 → 编码 → 过噪（可关）→ 硬判决译码，数前 infoBits 位错。 */
function simulateConv(params: ConvParams) {
  const seedUsed = deriveSeed(CUSTOM_SEED, Math.round(params.ebN0 * 10) + params.infoBits * 100 + (params.noise ? 1 : 0))
  const bitRng = createRng(seedUsed)
  const bits: number[] = []
  for (let i = 0; i < params.infoBits; i += 1) bits.push(bitRng.next() > 0.5 ? 1 : 0)

  const encoded = encodeConvolutional(bits)
  // 码率 1/2：同样的 Eb/N0 下，每个码符号只有一半能量。
  const esN0 = params.ebN0 + 10 * Math.log10(0.5)
  const sigma = params.noise ? Math.sqrt(1 / (2 * Math.pow(10, esN0 / 10))) : 0
  const received = transmit(encoded.coded, sigma, createRng(deriveSeed(seedUsed, params.infoBits)))
  const decoded = decodeHard(received.map(sliceHard)).slice(0, bits.length)

  let errors = 0
  for (let i = 0; i < bits.length; i += 1) if (decoded[i] !== bits[i]) errors += 1
  return { errors, total: bits.length, seedUsed }
}

/** OFDM：CP、延时、符号数交给 runOfdm，答案取 CP 支路的误符号数。 */
function simulateOfdm(params: OfdmParams) {
  const result = runOfdm({
    cpLen: params.cpLen,
    delay: params.delay,
    symbolCount: params.symbolCount,
    seed: CUSTOM_SEED,
  })
  return {
    errors: result.withCp.symbolErrors,
    total: result.withCp.symbolCount,
    seedUsed: CUSTOM_SEED,
  }
}

function qamQuestion(order: number, snrDb: number, sampleBits: number): QuestionResult {
  const result = createCustomQuestion({ order, snrDb, sampleBits })
  if (!result.ok) return { ok: false, message: result.message }
  const q: CustomQuestion = result.question
  return {
    ok: true,
    question: {
      kind: 'qam',
      params: { order, snrDb, sampleBits },
      prompt: `${q.label}，Es/N0 = ${snrDb} dB，样本量 ${numberText(q.sampleBits)} 比特。这组参数下的误码率是多少？`,
      summary: `${q.label} · ${snrDb} dB · ${numberText(q.sampleBits)} 比特`,
      answerKind: 'rate',
      errors: q.bitErrors,
      total: q.bitCount,
      truth: q.ber,
      seedUsed: q.seedUsed,
    },
  }
}

function convQuestion(ebN0: number, infoBits: number, noise: boolean): QuestionResult {
  if (!Number.isFinite(ebN0) || ebN0 < CONV_MIN_EBN0 || ebN0 > CONV_MAX_EBN0) {
    return { ok: false, message: `卷积题的 Eb/N0 要在 ${CONV_MIN_EBN0}–${CONV_MAX_EBN0} dB 之间。` }
  }
  if (!Number.isInteger(infoBits) || infoBits < 1 || infoBits > CONV_MAX_INFO_BITS) {
    return {
      ok: false,
      message: `卷积题的信息比特数只能填 1–${CONV_MAX_INFO_BITS}：页面上的短序列一次只摆 ${CONV_MAX_INFO_BITS} 位，再长就放不下了。`,
    }
  }
  const stats = simulateConv({ ebN0, infoBits, noise })
  return {
    ok: true,
    question: {
      kind: 'conv',
      params: { ebN0, infoBits, noise },
      prompt: `卷积码（码率 1/2、约束长度 3、硬判决），每信息比特 Eb/N0 = ${ebN0} dB，信息比特 ${infoBits} 个，${noise ? '开' : '关'}噪声。译码后还剩几个信息比特错？`,
      summary: `卷积码 · ${ebN0} dB · ${infoBits} 比特 · ${noise ? '有噪声' : '无噪声'}`,
      answerKind: 'count',
      errors: stats.errors,
      total: stats.total,
      truth: stats.errors,
      seedUsed: stats.seedUsed,
    },
  }
}

function ofdmQuestion(cpLen: number, delay: number, symbolCount: number): QuestionResult {
  if (!Number.isInteger(cpLen) || cpLen < 0 || cpLen > MAX_CP) {
    return { ok: false, message: `OFDM 题的 CP 长度要在 0–${MAX_CP} 之间。` }
  }
  if (!Number.isInteger(delay) || delay < 0 || delay > MAX_DELAY) {
    return { ok: false, message: `OFDM 题的延时要在 0–${MAX_DELAY} 之间。` }
  }
  if (!Number.isInteger(symbolCount) || symbolCount < OFDM_MIN_SYMBOLS || symbolCount > OFDM_MAX_SYMBOLS) {
    return { ok: false, message: `OFDM 题的符号数要在 ${OFDM_MIN_SYMBOLS}–${OFDM_MAX_SYMBOLS} 之间。` }
  }
  const stats = simulateOfdm({ cpLen, delay, symbolCount })
  return {
    ok: true,
    question: {
      kind: 'ofdm',
      params: { cpLen, delay, symbolCount },
      prompt: `OFDM（64 个子载波、QPSK），CP 长度 ${cpLen}，延时 ${delay}，${symbolCount} 个 OFDM 符号。CP 支路一共错几个 QPSK 符号？`,
      summary: `OFDM · CP ${cpLen} · 延时 ${delay} · ${symbolCount} 符号`,
      answerKind: 'count',
      errors: stats.errors,
      total: stats.total,
      truth: stats.errors,
      seedUsed: stats.seedUsed,
    },
  }
}

export function createLabQuestion(kind: QuestionKind, params: Partial<QuestionParams>): QuestionResult {
  if (kind === 'qam') {
    const p = params as Partial<QamParams>
    return qamQuestion(Number(p.order), Number(p.snrDb), Number(p.sampleBits))
  }
  if (kind === 'conv') {
    const p = params as Partial<ConvParams>
    return convQuestion(Number(p.ebN0), Number(p.infoBits), p.noise !== false)
  }
  const p = params as Partial<OfdmParams>
  return ofdmQuestion(Number(p.cpLen), Number(p.delay), Number(p.symbolCount))
}

/** 计数题的分数必须写清分母；比率题复用 QAM 的 10% / 1e-5 容差。 */
export function gradeLabAnswer(question: LabQuestion, raw: string): LabGrade {
  const trimmed = raw.trim()
  if (trimmed === '') return { parsed: null, correct: false, reason: '先填一个答案再判分。' }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { parsed: null, correct: false, reason: '这不是一个数，填数字或者科学计数法。' }

  if (question.answerKind === 'count') {
    const unit = question.kind === 'conv' ? '信息比特' : 'QPSK 符号'
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { parsed, correct: false, reason: `这是个计数题，填 0 或正整数；分母是 ${numberText(question.total)} 个${unit}。` }
    }
    if (parsed === question.truth) {
      return {
        parsed,
        correct: true,
        reason: `对：仿真答案 ${question.truth} 个（共 ${numberText(question.total)} 个${unit}）。`,
      }
    }
    return {
      parsed,
      correct: false,
      reason: `不对：仿真答案 ${question.truth} 个（共 ${numberText(question.total)} 个${unit}），你填 ${parsed}，差 ${Math.abs(parsed - question.truth)} 个。`,
    }
  }

  const tolerance = Math.max(question.truth * CUSTOM_RELATIVE_TOLERANCE, CUSTOM_ABSOLUTE_TOLERANCE)
  if (question.truth === 0) {
    if (parsed === 0) return { parsed, correct: true, reason: '对：这次一个比特都没错，答案就是 0。' }
    return {
      parsed,
      correct: false,
      reason: `不对：仿真答案 0（共 ${numberText(question.total)} 个比特一个没多），你填 ${formatBer(parsed)}；真值为 0 时只认 0。`,
    }
  }
  if (Math.abs(parsed - question.truth) <= tolerance) {
    return {
      parsed,
      correct: true,
      reason: `对：仿真答案 ${formatBer(question.truth)}（错 ${numberText(question.errors)} / 共 ${numberText(question.total)} 比特），容差 ±${formatBer(tolerance)}。`,
    }
  }
  return {
    parsed,
    correct: false,
    reason: `不对：仿真答案 ${formatBer(question.truth)}（错 ${numberText(question.errors)} / 共 ${numberText(question.total)} 比特），你填 ${formatBer(parsed)}，超出容差 ±${formatBer(tolerance)}。`,
  }
}

/* ---------- 查询串：出题页生成，实验台解析 ---------- */

export function qamHref(p: QamParams): string {
  return `#/qam?order=${p.order}&snr=${p.snrDb}&bits=${p.sampleBits}`
}
export function convHref(p: ConvParams): string {
  return `#/conv?ebn0=${p.ebN0}&bits=${p.infoBits}&noise=${p.noise ? 1 : 0}`
}
export function ofdmHref(p: OfdmParams): string {
  return `#/ofdm?cp=${p.cpLen}&delay=${p.delay}&symbols=${p.symbolCount}`
}

export function labHref(question: LabQuestion): string {
  if (question.kind === 'qam') return qamHref(question.params as QamParams)
  if (question.kind === 'conv') return convHref(question.params as ConvParams)
  return ofdmHref(question.params as OfdmParams)
}

export function readQuery(hash: string): Record<string, string> {
  const at = hash.indexOf('?')
  if (at === -1) return {}
  const out: Record<string, string> = {}
  new URLSearchParams(hash.slice(at + 1)).forEach((value, key) => {
    out[key] = value
  })
  return out
}

const asNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const asInt = (value: string | undefined): number | undefined => {
  const n = asNumber(value)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}

/** 只认四档阶数；坏值当没写。 */
export function readQamParams(hash: string) {
  const query = readQuery(hash)
  const order = asInt(query.order)
  const snrDb = asNumber(query.snr)
  const sampleBits = asInt(query.bits)
  const validOrder = order !== undefined && (QAM_ORDERS as readonly number[]).includes(order) ? order : 16
  const validSnr = snrDb !== undefined && snrDb >= 0 && snrDb <= 20 ? snrDb : 12
  const maxBits = 200000
  const validBits =
    sampleBits !== undefined && sampleBits >= 1 && sampleBits <= maxBits ? sampleBits : 20000
  return {
    order: validOrder,
    snrDb: validSnr,
    sampleBits: validBits,
    fromQuery:
      (order !== undefined && validOrder === order) ||
      (snrDb !== undefined && validSnr === snrDb) ||
      (sampleBits !== undefined && validBits === sampleBits),
  }
}

export function readConvParams(hash: string) {
  const query = readQuery(hash)
  const ebN0 = asNumber(query.ebn0)
  const infoBits = asInt(query.bits)
  const noiseRaw = query.noise
  const validEb = ebN0 !== undefined && ebN0 >= CONV_MIN_EBN0 && ebN0 <= CONV_MAX_EBN0 ? ebN0 : 2
  const validBits = infoBits !== undefined && infoBits >= 1 && infoBits <= CONV_MAX_INFO_BITS ? infoBits : 12
  const noise = noiseRaw === '0' || noiseRaw === 'false' ? false : true
  return {
    ebN0: validEb,
    infoBits: validBits,
    noise,
    fromQuery:
      (ebN0 !== undefined && validEb === ebN0) ||
      (infoBits !== undefined && validBits === infoBits) ||
      noiseRaw === '0' ||
      noiseRaw === 'false',
  }
}

export function readOfdmParams(hash: string) {
  const query = readQuery(hash)
  const cpLen = asInt(query.cp)
  const delay = asInt(query.delay)
  const symbolCount = asInt(query.symbols)
  const validCp = cpLen !== undefined && cpLen >= 0 && cpLen <= MAX_CP ? cpLen : 16
  const validDelay = delay !== undefined && delay >= 0 && delay <= MAX_DELAY ? delay : 9
  const validSymbols =
    symbolCount !== undefined && symbolCount >= OFDM_MIN_SYMBOLS && symbolCount <= OFDM_MAX_SYMBOLS
      ? symbolCount
      : 200
  return {
    cpLen: validCp,
    delay: validDelay,
    symbolCount: validSymbols,
    fromQuery:
      (cpLen !== undefined && validCp === cpLen) ||
      (delay !== undefined && validDelay === delay) ||
      (symbolCount !== undefined && validSymbols === symbolCount),
  }
}

/* ---------- 本地存档：新记录带 kind，旧记录当 QAM ---------- */

export type SavedLabQuestion = {
  id: string
  savedAt: string
  kind: QuestionKind
  params: QuestionParams
  summary: string
  errors: number
  total: number
  truth: number
  given: number
  correct: boolean
}

export type SavedLoadResult = { items: SavedLabQuestion[]; error: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toSaved(value: unknown): SavedLabQuestion | null {
  if (!isRecord(value)) return null
  const id = value.id
  const savedAt = value.savedAt
  const truth = value.truth
  const given = value.given
  const correct = value.correct
  if (typeof id !== 'string' || typeof savedAt !== 'string') return null
  if (typeof truth !== 'number' || typeof given !== 'number' || typeof correct !== 'boolean') return null

  if (value.kind === 'conv') {
    const p = value.params
    if (!isRecord(p)) return null
    const ebN0 = p.ebN0
    const infoBits = p.infoBits
    const noise = p.noise
    if (typeof ebN0 !== 'number' || typeof infoBits !== 'number' || typeof noise !== 'boolean') return null
    return {
      id,
      savedAt,
      kind: 'conv',
      params: { ebN0, infoBits, noise },
      summary: typeof value.summary === 'string' ? value.summary : '卷积码',
      errors: Number(value.errors),
      total: Number(value.total),
      truth,
      given,
      correct,
    }
  }

  if (value.kind === 'ofdm') {
    const p = value.params
    if (!isRecord(p)) return null
    const cpLen = p.cpLen
    const delay = p.delay
    const symbolCount = p.symbolCount
    if (typeof cpLen !== 'number' || typeof delay !== 'number' || typeof symbolCount !== 'number') return null
    return {
      id,
      savedAt,
      kind: 'ofdm',
      params: { cpLen, delay, symbolCount },
      summary: typeof value.summary === 'string' ? value.summary : 'OFDM',
      errors: Number(value.errors),
      total: Number(value.total),
      truth,
      given,
      correct,
    }
  }

  if (value.kind === 'qam') {
    const p = value.params
    if (!isRecord(p)) return null
    const order = p.order
    const snrDb = p.snrDb
    const sampleBits = p.sampleBits
    if (typeof order !== 'number' || typeof snrDb !== 'number' || typeof sampleBits !== 'number') {
      return null
    }
    return {
      id,
      savedAt,
      kind: 'qam',
      params: { order, snrDb, sampleBits },
      summary:
        typeof value.summary === 'string'
          ? value.summary
          : `${orderLabel(order)} · ${snrDb} dB · ${numberText(sampleBits)} 比特`,
      errors: Number(value.errors),
      total: Number(value.total),
      truth,
      given,
      correct,
    }
  }

  // 旧记录没有 kind：按 QAM 读，字段与 v1 存档一致。
  const order = value.order
  const snrDb = value.snrDb
  const sampleBits = value.sampleBits
  const bitErrors = value.bitErrors
  const bitCount = value.bitCount
  if (
    typeof order !== 'number' ||
    typeof snrDb !== 'number' ||
    typeof sampleBits !== 'number' ||
    typeof bitErrors !== 'number' ||
    typeof bitCount !== 'number'
  ) {
    return null
  }
  return {
    id,
    savedAt,
    kind: 'qam',
    params: { order, snrDb, sampleBits },
    summary: `${orderLabel(order)} · ${snrDb} dB · ${numberText(sampleBits)} 比特`,
    errors: bitErrors,
    total: bitCount,
    truth,
    given,
    correct,
  }
}

export function loadSavedLabQuestions(storage: StorageLike): SavedLoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(CUSTOM_STORAGE_KEY)
  } catch {
    return { items: [], error: '本地记录读不出来，已忽略。' }
  }
  if (!raw) return { items: [], error: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { items: [], error: '本地记录读不出来，已忽略。' }
  }
  if (!Array.isArray(parsed)) return { items: [], error: '本地记录读不出来，已忽略。' }

  const items: SavedLabQuestion[] = []
  let skipped = 0
  for (const entry of parsed) {
    const saved = toSaved(entry)
    if (saved) items.push(saved)
    else skipped += 1
  }
  return { items, error: skipped > 0 ? `有 ${skipped} 条本地记录字段不全，已跳过。` : null }
}

export function createSavedLabRecord(
  question: LabQuestion,
  given: number,
  correct: boolean,
  savedAt: string,
  id: string,
): SavedLabQuestion {
  return {
    id,
    savedAt,
    kind: question.kind,
    params: question.params,
    summary: question.summary,
    errors: question.errors,
    total: question.total,
    truth: question.truth,
    given,
    correct,
  }
}

export function saveSavedLabQuestion(
  storage: StorageLike,
  record: SavedLabQuestion,
): { ok: boolean; items: SavedLabQuestion[]; error: string | null } {
  const loaded = loadSavedLabQuestions(storage)
  if (loaded.error && loaded.items.length === 0 && loaded.error.includes('读不出来')) {
    return { ok: false, items: [], error: loaded.error }
  }
  const items = [record, ...loaded.items]
  try {
    storage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(items))
  } catch {
    return { ok: false, items: loaded.items, error: '本地存储写不进去，这道题没存上。' }
  }
  return { ok: true, items, error: loaded.error }
}

export function removeSavedLabQuestion(
  storage: StorageLike,
  id: string,
): { ok: boolean; items: SavedLabQuestion[]; error: string | null } {
  const loaded = loadSavedLabQuestions(storage)
  const items = loaded.items.filter((item) => item.id !== id)
  try {
    storage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(items))
  } catch {
    return { ok: false, items: loaded.items, error: '本地存储写不进去，删不掉。' }
  }
  return { ok: true, items, error: loaded.error }
}

/** QAM 参数摘要里带上每符号比特数，出题页给回填按钮做提示用。 */
export const qamBitsPerSymbol = (order: number) => bitsPerSymbol(order)
export { SUBCARRIERS }
