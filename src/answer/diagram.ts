/**
 * 课本级配图的规格与白名单校验。
 *
 * 模型回来的 JSON 里可能带 `diagram` 字段，但模型不负责画图——它只报「画什么」：
 * 比特串、码元速率、载波频率、要不要画原理框图。画法由前端固定（见
 * `src/labs/AnswerDiagram.tsx`），所以这里只做一件事：把不合规的规格挡在门外。
 *
 * 原则：不猜、不补默认值、不截断。任一项不合规就返回 null，那边直接不画。
 */

export const DIAGRAM_KINDS = ['psk-time'] as const

export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

export type PskTimeDiagram = {
  kind: 'psk-time'
  /** 比特串，只含 0 与 1，长度 4–16。 */
  bits: string
  /** 码元速率（Baud）。 */
  bitRate: number
  /** 载波频率（Hz）。 */
  carrierHz: number
  /** 是否画第一段的原理框图。 */
  showBlock: boolean
}

/** 白名单边界：这些值只在这里出现一次，测试与界面都读它。 */
export const DIAGRAM_LIMITS = {
  bitsMin: 4,
  bitsMax: 16,
  bitRateMin: 100,
  bitRateMax: 10000,
  carrierMin: 100,
  carrierMax: 20000,
} as const

export const BIT_SEGMENT_TEXT = /^[01]{4,16}$/

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** 校验一条 `diagram` 规格；任何一项不合规都返回 null。 */
export function parseDiagram(value: unknown): PskTimeDiagram | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.kind !== 'psk-time') return null
  const bits = row.bits
  if (typeof bits !== 'string' || !BIT_SEGMENT_TEXT.test(bits)) return null
  if (!inRange(row.bitRate, DIAGRAM_LIMITS.bitRateMin, DIAGRAM_LIMITS.bitRateMax)) return null
  if (!inRange(row.carrierHz, DIAGRAM_LIMITS.carrierMin, DIAGRAM_LIMITS.carrierMax)) return null
  if (typeof row.showBlock !== 'boolean') return null
  return { kind: 'psk-time', bits, bitRate: row.bitRate, carrierHz: row.carrierHz, showBlock: row.showBlock }
}

/** 一个码元占多少秒。 */
export function symbolSeconds(spec: PskTimeDiagram): number {
  return 1 / spec.bitRate
}

/** 整段波形多长（秒）。 */
export function diagramSeconds(spec: PskTimeDiagram): number {
  return spec.bits.length * symbolSeconds(spec)
}

/** 码元边界（毫秒），含 0 与末尾，共 bits.length + 1 个。 */
export function bitBoundariesMs(spec: PskTimeDiagram): number[] {
  const step = symbolSeconds(spec) * 1000
  return Array.from({ length: spec.bits.length + 1 }, (_, index) => Number((index * step).toFixed(6)))
}

/** 每码元几个载波周期；整数时给 N，否则给 null。 */
export function cyclesPerSymbol(spec: PskTimeDiagram): number | null {
  const ratio = spec.carrierHz / spec.bitRate
  const rounded = Math.round(ratio)
  return Math.abs(ratio - rounded) < 1e-9 ? rounded : null
}

/** 底注：按传入的两个参数现算，不写死。 */
export function diagramFootnote(spec: PskTimeDiagram): string {
  const cycles = cyclesPerSymbol(spec)
  if (cycles !== null) {
    return `f_c·T_b = ${cycles}，每码元 ${cycles} 个载波周期，相位翻转落在峰点`
  }
  const ratio = spec.carrierHz / spec.bitRate
  return `非整数个载波周期（f_c/f_b = ${ratio.toFixed(2)}），相位翻转不在峰点`
}