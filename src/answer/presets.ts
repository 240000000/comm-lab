import { CHANNEL_BANDS } from '../core/course.ts'

/**
 * 题面参数 → 课程视图档位。
 *
 * 这个文件只做算术与字符串，不碰 DOM，也不认识 React：
 * 左栏算出「本屏该用哪组参数」，右栏 iframe 用 `preset=` 把同一组参数带过去，
 * 两边的数字才会是同一个数字。
 */
export type PresetValues = Record<string, number>
export type PresetSpec = { no: number; values: PresetValues }

/** 第 4 章带宽档的匹配结果：对上就给两个参数，对不上就明说最近的两档。 */
export type BandMatch =
  | { status: 'ok'; values: PresetValues }
  | { status: 'no-exact-band'; asked: number; nearest: number[] }

/** 档位名：1 kHz 以下保留一位小数，整数档不带小数点。 */
export function bandLabel(bandKhz: number): string {
  return Number.isInteger(bandKhz) ? `${bandKhz} kHz` : `${bandKhz} kHz`
}

/**
 * 第 4 章：教材口径给的是「带宽 B + 输出端总信噪比 S/N」，
 * 而实验台的两根滑杆是「1 kHz 参考带宽下的 SNR₀ + 对数档位的 index」。
 *
 * S/N₀ = S/N · B（都以 1 kHz 为参考），换成 dB 就是 10·lg(10^(S/N/10)·B kHz)。
 */
export function channelPreset(input: { bandKhz: number; snrDb: number }): BandMatch {
  const { bandKhz, snrDb } = input
  const index = CHANNEL_BANDS.indexOf(bandKhz as (typeof CHANNEL_BANDS)[number])
  if (index < 0) {
    const lower = [...CHANNEL_BANDS].reverse().find((b) => b < bandKhz)
    const upper = CHANNEL_BANDS.find((b) => b > bandKhz)
    const nearest = [lower, upper]
      .filter((b) => b !== undefined)
      .map((b) => b as number)
    return { status: 'no-exact-band', asked: bandKhz, nearest }
  }
  // 不取整：取整会让右栏读数从 49.84 变成 49.85，左边 49.8 就对不上了。
  const snr0Db = 10 * Math.log10(10 ** (snrDb / 10) * bandKhz)
  return { status: 'ok', values: { bandIndex: index, snr0Db } }
}

/** 对不上的那句人话：「题设 3 kHz 不在本屏档位（最近 2 / 5 kHz）」。 */
export function bandMissNote(result: Extract<BandMatch, { status: 'no-exact-band' }>): string {
  const near = result.nearest.map(bandLabel).join(' / ')
  return near
    ? `题设 ${bandLabel(result.asked)} 不在本屏档位（最近 ${near}）`
    : `题设 ${bandLabel(result.asked)} 不在本屏档位`
}

/** 第 7 章：Eb/N₀ 的滑杆是整数 dB（0–12），题面给 9.59 就落到 10。 */
export function pskPreset(input: { ebn0Db: number }): PresetValues {
  const ebn0Db = Math.min(12, Math.max(0, Math.round(input.ebn0Db)))
  return { ebn0Db }
}

/** 第 12 章：级数的滑杆是档位下标（n=4 是 0），题面给级数 n 就减 4。 */
export function mseqPreset(input: { stages: number }): PresetValues {
  const level = Math.min(3, Math.max(0, Math.round(input.stages) - 4))
  return { level }
}

/** 编码成地址栏里能直接看懂的 `4:bandIndex=5,snr0Db=37`。 */
export function encodePreset(spec: PresetSpec): string {
  // 保留四位小数：S/N₀ 这类换算是 36.989700…，地址栏里没必要拖一串尾巴。
  const round = (value: number) => Number(value.toFixed(4))
  const pairs = Object.keys(spec.values)
    .sort()
    .map((key) => `${key}=${round(spec.values[key])}`)
    .join(',')
  return `${spec.no}:${pairs}`
}

/**
 * 解码 preset 串。任何一处不对（章节号越界、值不是有限数、格式缺项）
 * 都返回 null —— 调用方拿 null 就当没传 preset，绝不抛错、绝不清空页面。
 */
export function decodePreset(raw: string | null | undefined): PresetSpec | null {
  if (!raw) return null
  const colon = raw.indexOf(':')
  if (colon <= 0) return null
  const no = Number(raw.slice(0, colon))
  if (!Number.isInteger(no) || no < 1 || no > 13) return null
  const values: PresetValues = {}
  for (const pair of raw.slice(colon + 1).split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) return null
    const key = pair.slice(0, eq).trim()
    const value = Number(pair.slice(eq + 1))
    if (!key || !Number.isFinite(value)) return null
    values[key] = value
  }
  if (Object.keys(values).length === 0) return null
  return { no, values }
}

/**
 * 把 preset 合进某章的 defaults：只认这一章真有的参数键，
 * 章节号不对或键不认识就原样返回 defaults（不报错、不改半截）。
 */
export function applyPreset(
  defaults: PresetValues,
  spec: PresetSpec | null,
  chapterNo: number,
  allowed: string[],
): PresetValues {
  if (!spec || spec.no !== chapterNo) return defaults
  const next: PresetValues = { ...defaults }
  let touched = 0
  for (const key of allowed) {
    const value = spec.values[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[key] = value
      touched += 1
    }
  }
  return touched > 0 ? next : defaults
}