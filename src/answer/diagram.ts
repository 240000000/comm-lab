/**
 * 答题卡图形的白名单与校验。
 *
 * 模型只允许返回这里列出的几种图；任何一项不合规就整体判 null，界面改成
 * 一句「画不了」，绝不把半个图硬画出来。物理与排版都不在这里，这里只做
 * 「什么样的数才算数」。
 */

export const DIAGRAM_KINDS = ['psk-time', 'fsk-time'] as const

export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

/** 2ASK / 2PSK / 2DPSK 的时间波形：一个载波频率。 */
export type PskTimeDiagram = {
  kind: 'psk-time'
  bits: string
  bitRate: number
  carrierHz: number
  showBlock: boolean
}

/** 2FSK 的时间波形：两个独立振荡器，按比特在这两个频率之间切换。 */
export type FskTimeDiagram = {
  kind: 'fsk-time'
  bits: string
  bitRate: number
  carrierHzLow: number
  carrierHzHigh: number
}

export type TimeDiagram = PskTimeDiagram | FskTimeDiagram

export const DIAGRAM_LIMITS = {
  bitsMin: 4,
  bitsMax: 16,
  bitRateMin: 100,
  bitRateMax: 10_000,
  carrierMin: 100,
  carrierMax: 20_000,
} as const

/** 比特串只收 4–16 个 0 / 1。 */
export const BIT_SEGMENT_TEXT = /^[01]{4,16}$/

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function bitsOk(value: unknown): value is string {
  return typeof value === 'string' && BIT_SEGMENT_TEXT.test(value)
}

/** 校验一份模型给的图形规格；不合规返回 null。 */
export function parseDiagram(value: unknown): TimeDiagram | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.kind !== 'string') return null
  if (!bitsOk(row.bits)) return null
  if (!inRange(row.bitRate, DIAGRAM_LIMITS.bitRateMin, DIAGRAM_LIMITS.bitRateMax)) return null

  if (row.kind === 'psk-time') {
    if (!inRange(row.carrierHz, DIAGRAM_LIMITS.carrierMin, DIAGRAM_LIMITS.carrierMax)) return null
    // showBlock 必须是真布尔：写成 'yes' 这类字符串就当整份不合规。
    if (typeof row.showBlock !== 'boolean') return null
    return {
      kind: 'psk-time',
      bits: row.bits,
      bitRate: row.bitRate,
      carrierHz: row.carrierHz,
      showBlock: row.showBlock,
    }
  }

  if (row.kind === 'fsk-time') {
    const low = row.carrierHzLow
    const high = row.carrierHzHigh
    if (!inRange(low, DIAGRAM_LIMITS.carrierMin, DIAGRAM_LIMITS.carrierMax)) return null
    if (!inRange(high, DIAGRAM_LIMITS.carrierMin, DIAGRAM_LIMITS.carrierMax)) return null
    if (high <= low) return null
    return { kind: 'fsk-time', bits: row.bits, bitRate: row.bitRate, carrierHzLow: low, carrierHzHigh: high }
  }

  return null
}

/** 一个码元多少秒。 */
export function symbolSeconds(spec: TimeDiagram): number {
  return 1 / spec.bitRate
}

/** 整段波形多少秒。 */
export function diagramSeconds(spec: TimeDiagram): number {
  return spec.bits.length * symbolSeconds(spec)
}

/** 每个码元边界的时刻（毫秒），含两端，共 bits.length + 1 个。 */
export function bitBoundariesMs(spec: TimeDiagram): number[] {
  const step = symbolSeconds(spec) * 1000
  return Array.from({ length: spec.bits.length + 1 }, (_, index) => Number((index * step).toFixed(6)))
}

/** 载波周期 / 码元周期；整数才有意义（相位翻转正好落在峰点）。 */
export function cyclesPerSymbol(spec: PskTimeDiagram): number | null {
  const ratio = spec.carrierHz / spec.bitRate
  return Math.abs(ratio - Math.round(ratio)) < 1e-9 ? Math.round(ratio) : null
}

/** 2FSK 每个码元画几个完整周期：向下取整，两个频率各一个数。 */
export function fskCyclesPerSymbol(spec: FskTimeDiagram): { high: number; low: number } {
  return {
    high: Math.floor(spec.carrierHzHigh / spec.bitRate),
    low: Math.floor(spec.carrierHzLow / spec.bitRate),
  }
}

/** 2FSK 的带宽估计：B ≈ |f1 − f0| + 2R_B。 */
export function fskBandwidth(spec: FskTimeDiagram): number {
  return Math.abs(spec.carrierHzHigh - spec.carrierHzLow) + 2 * spec.bitRate
}

/** 一个频率值的写法：整数就不带小数点。 */
export function hzText(hz: number): string {
  const rounded = Math.round(hz * 100) / 100
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(2)}`
}

/** 底注：`f_c·T_b` 与每码元几个周期（2ASK / 2PSK / 2DPSK）。 */
export function diagramFootnote(spec: PskTimeDiagram): string {
  const cycles = cyclesPerSymbol(spec)
  if (cycles !== null) {
    return `f_c·T_b = ${cycles}，每码元 ${cycles} 个载波周期，相位翻转落在峰点`
  }
  const ratio = (spec.carrierHz / spec.bitRate).toFixed(2)
  return `非整数个载波周期（f_c/f_b = ${ratio}），相位翻转不在峰点`
}

/** 底注：两个频率各几个周期，再加带宽估计（2FSK）。 */
export function fskFootnote(spec: FskTimeDiagram): string {
  const cycles = fskCyclesPerSymbol(spec)
  const band = fskBandwidth(spec)
  const bandText = band >= 1000 ? `${Number((band / 1000).toFixed(2))} kHz` : `${hzText(band)} Hz`
  return `f1 = ${hzText(spec.carrierHzHigh)} Hz、f0 = ${hzText(spec.carrierHzLow)} Hz；每码元 ${cycles.high} / ${cycles.low} 个周期；B ≈ |f1−f0| + 2R_B = ${bandText}`
}