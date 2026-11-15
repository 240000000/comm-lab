/**
 * 课程视图的「命名档位」：每章两个，a 档就是默认参数，b 档换一两个参数。
 *
 * 为什么单独放一个文件：`src/core/course.ts` 里的 compute 与默认参数是这一屏的
 * 物理账本，改动它会让已有读数整体漂移；档位只是「同一套公式换一组输入」，属于
 * 入口层的约定，所以放在 course/ 里、由课程视图与功能面板共用。
 *
 * 两条硬约束（由 tests/presets.test.ts 钉住）：
 *  1. a 档的 params 必须与 COURSE_CHAPTERS 里该章的 defaults 完全相等；
 *  2. 任何一档都不许等于该章的 failPreset（failPreset 是「演示失败」的那组）。
 *
 * 每个 b 档都实测过：同一章跑两档，readouts 至少一个值不同，或 series 逐点不全
 * 相同——看不出差别的档位一律不算数。
 */
import { COURSE_CHAPTERS } from '../core/course.ts'

/** 档位 id：a = 默认档，b = 换过参数的那一档。 */
export type CoursePresetId = 'a' | 'b'

export type CoursePreset = {
  id: CoursePresetId
  /** 参数条上方那两个小按钮上的档名。 */
  label: string
  /** 该档的完整参数（不是差量），直接喂给该章 compute。 */
  params: Record<string, number>
}

/** 默认档的档名：不带 preset 参数进页面时用的就是它。 */
export const DEFAULT_PRESET_LABEL = '默认档'

/**
 * 每章两条档位，按章号索引。b 档的参数就是用户给的「换一个或两个」：
 * 默认参数 + 表里写的那些键，其余键沿用 defaults。
 */
export const COURSE_PRESETS: Record<number, CoursePreset[]> = {
  1: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { p: 0.5, sample: 3, basis: 0 } },
    { id: 'b', label: '几乎必然', params: { p: 0.99, sample: 3, basis: 0 } },
  ],
  2: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { tau: 1.5, shape: 0, kind: 0 } },
    { id: 'b', label: '周期功率串', params: { tau: 1.5, shape: 0, kind: 1 } },
  ],
  3: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { kind: 0, timeIndex: 3, k: 100 } },
    { id: 'b', label: '一阶低通', params: { kind: 1, timeIndex: 3, k: 100 } },
  ],
  4: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { snr0Db: 20, bandIndex: 3 } },
    { id: 'b', label: '窄带对照', params: { snr0Db: 20, bandIndex: 0 } },
  ],
  5: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { mode: 0, m: 0.6, beta: 2, snrIn: 25 } },
    { id: 'b', label: 'FM β=2', params: { mode: 3, m: 0.6, beta: 2, snrIn: 25 } },
  ],
  6: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { alpha: 0.35, eyeSnrDb: 20, multipath: 0, timing: 0 } },
    { id: 'b', label: '大滚降 + 偏 0.2T', params: { alpha: 0.9, eyeSnrDb: 20, multipath: 0, timing: 0.2 } },
  ],
  7: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { scheme: 2, ebn0Db: 8, phaseDeg: 0 } },
    { id: 'b', label: '2ASK 对照', params: { scheme: 0, ebn0Db: 8, phaseDeg: 0 } },
  ],
  8: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { mod: 1, ebn0Db: 12, alpha: 0.35 } },
    { id: 'b', label: '64QAM', params: { mod: 2, ebn0Db: 12, alpha: 0.35 } },
  ],
  9: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { wave: 0, dt: 0, ebn0Db: 8 } },
    { id: 'b', label: '半正弦', params: { wave: 2, dt: 0, ebn0Db: 8 } },
  ],
  10: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { fs: 4, bits: 8, compand: 0 } },
    { id: 'b', label: '12 bit + A 律', params: { fs: 4, bits: 12, compand: 1 } },
  ],
  11: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { level: 0, errors: 1 } },
    { id: 'b', label: '(15,11)', params: { level: 1, errors: 1 } },
  ],
  12: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { level: 3, tau: 0, taps: 0 } },
    { id: 'b', label: 'n=4·周期 15', params: { level: 0, tau: 0, taps: 0 } },
  ],
  13: [
    { id: 'a', label: DEFAULT_PRESET_LABEL, params: { k: 0.6, theta0: 2, sigma: 0 } },
    { id: 'b', label: '慢锁', params: { k: 0.1, theta0: 2, sigma: 0 } },
  ],
}

/** 该章的两条档位；章号不在 1–13 时返回空数组。 */
export function presetsForChapter(no: number): CoursePreset[] {
  return COURSE_PRESETS[no] ?? []
}

/** 按章号 + 档位取参数；找不到就退回该章默认参数（第 4 条：不带 preset 时行为不变）。 */
export function presetParams(no: number, id: CoursePresetId | null): Record<string, number> {
  const chapter = COURSE_CHAPTERS.find((c) => c.no === no)
  const fallback = chapter ? { ...chapter.defaults } : {}
  if (id === null) return fallback
  const preset = presetsForChapter(no).find((item) => item.id === id)
  return preset ? { ...preset.params } : fallback
}

/** 地址栏里 `preset=` 的合法取值只有 a / b；其余（含答题模式的 `4:xxx=1`）不算档位。 */
export function readPresetId(raw: string | null): CoursePresetId | null {
  if (raw === 'a' || raw === 'b') return raw
  return null
}