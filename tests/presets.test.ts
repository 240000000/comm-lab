import assert from 'node:assert/strict'
import test from 'node:test'

import { COURSE_CHAPTERS } from '../src/core/course.ts'
import {
  COURSE_PRESETS,
  DEFAULT_PRESET_LABEL,
  presetParams,
  presetsForChapter,
  readPresetId,
} from '../src/course/presets.ts'

/** 用户给定的 13 个 b 档：档名 + 完整参数，一条一条钉死。 */
const EXPECTED_B: Record<number, { label: string; params: Record<string, number> }> = {
  1: { label: '几乎必然', params: { p: 0.99, sample: 3, basis: 0 } },
  2: { label: '周期功率串', params: { tau: 1.5, shape: 0, kind: 1 } },
  3: { label: '一阶低通', params: { kind: 1, timeIndex: 3, k: 100 } },
  4: { label: '窄带对照', params: { snr0Db: 20, bandIndex: 0 } },
  5: { label: 'FM β=2', params: { mode: 3, m: 0.6, beta: 2, snrIn: 25 } },
  6: { label: '大滚降 + 偏 0.2T', params: { alpha: 0.9, eyeSnrDb: 20, multipath: 0, timing: 0.2 } },
  7: { label: '2ASK 对照', params: { scheme: 0, ebn0Db: 8, phaseDeg: 0 } },
  8: { label: '64QAM', params: { mod: 2, ebn0Db: 12, alpha: 0.35 } },
  9: { label: '半正弦', params: { wave: 2, dt: 0, ebn0Db: 8 } },
  10: { label: '12 bit + A 律', params: { fs: 4, bits: 12, compand: 1 } },
  11: { label: '(15,11)', params: { level: 1, errors: 1 } },
  12: { label: 'n=4·周期 15', params: { level: 0, tau: 0, taps: 0 } },
  13: { label: '慢锁', params: { k: 0.1, theta0: 2, sigma: 0 } },
}

test('每章 a 档参数与该章 defaults 完全相等', () => {
  assert.equal(COURSE_CHAPTERS.length, 13)
  for (const chapter of COURSE_CHAPTERS) {
    const presets = presetsForChapter(chapter.no)
    assert.equal(presets.length, 2, `第 ${chapter.no} 章应该正好两档`)
    const a = presets[0]
    assert.equal(a.id, 'a')
    assert.equal(a.label, DEFAULT_PRESET_LABEL)
    assert.deepEqual(a.params, chapter.defaults, `第 ${chapter.no} 章 a 档必须等于 defaults`)
  }
})

test('26 条的档名与 b 档参数逐条钉死', () => {
  let rows = 0
  for (const chapter of COURSE_CHAPTERS) {
    const presets = presetsForChapter(chapter.no)
    rows += presets.length
    const b = presets[1]
    const expected = EXPECTED_B[chapter.no]
    assert.ok(expected, `第 ${chapter.no} 章缺预期`)
    assert.equal(b.id, 'b')
    assert.equal(b.label, expected.label)
    assert.deepEqual(b.params, expected.params, `第 ${chapter.no} 章 b 档参数不对`)
    // 任何一档都不许等于 failPreset：演示失败那一组不能拿来当档位。
    for (const preset of presets) {
      assert.notDeepEqual(preset.params, chapter.failPreset, `第 ${chapter.no} 章 ${preset.id} 档撞上了 failPreset`)
    }
  }
  assert.equal(rows, 26)
})

test('b 档一律不等于 failPreset（13 章全查）', () => {
  // 档位是给人看的正常档，红色反例状态只留给「让它失效」按钮：
  // 一旦某章 b 档和 failPreset 重合，点进去就是红的，档位就废了。
  const same: number[] = []
  for (const chapter of COURSE_CHAPTERS) {
    const b = COURSE_PRESETS[chapter.no].find((preset) => preset.id === 'b')
    assert.ok(b, `第 ${chapter.no} 章缺 b 档`)
    const sameAsFail = Object.entries(chapter.failPreset).every(([key, value]) => b.params[key] === value)
    if (sameAsFail) same.push(chapter.no)
    assert.notDeepEqual(b.params, chapter.failPreset, `第 ${chapter.no} 章 b 档撞上了 failPreset`)
  }
  assert.deepEqual(same, [], `这些章的 b 档与 failPreset 重合：${same.join(',')}`)
})

test('每章两档跑出来的结果必须不同（读数或曲线至少一处不一样）', () => {
  for (const chapter of COURSE_CHAPTERS) {
    assert.ok(chapter.compute, `第 ${chapter.no} 章缺 compute`)
    const [a, b] = presetsForChapter(chapter.no)
    const viewA = chapter.compute!(a.params)
    const viewB = chapter.compute!(b.params)
    const readoutsDiffer = viewA.readouts.some((row, index) => {
      const other = viewB.readouts[index]
      return !other || row.value !== other.value
    })
    const seriesDiffer =
      JSON.stringify(viewA.series.map((line) => line.points)) !==
      JSON.stringify(viewB.series.map((line) => line.points))
    assert.ok(
      readoutsDiffer || seriesDiffer,
      `第 ${chapter.no} 章两档看不出差别：${JSON.stringify(a.params)} vs ${JSON.stringify(b.params)}`,
    )
  }
})

test('presetParams 与 readPresetId 的边界', () => {
  // 不带 preset：退回默认参数，与 a 档逐键相等。
  assert.deepEqual(presetParams(8, null), presetParams(8, 'a'))
  assert.deepEqual(presetParams(8, 'b'), EXPECTED_B[8].params)
  // 章号越界仍给空对象，不抛错。
  assert.deepEqual(presetParams(99, 'b'), {})
  assert.equal(readPresetId('a'), 'a')
  assert.equal(readPresetId('b'), 'b')
  // 答题模式那串 `4:bandIndex=5` 不是档位。
  assert.equal(readPresetId('4:bandIndex=5'), null)
  assert.equal(readPresetId(null), null)
  assert.equal(COURSE_PRESETS[1].length, 2)
})