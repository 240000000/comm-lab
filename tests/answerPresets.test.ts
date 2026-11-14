import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyPreset,
  bandMissNote,
  channelPreset,
  decodePreset,
  encodePreset,
  mseqPreset,
  pskPreset,
} from '../src/answer/presets.ts'
import { channelCapacity } from '../src/core/course.ts'

test('第 4 章：5 kHz 落在档位里，preset 换算后右栏读数等于题面 49.8', () => {
  const match = channelPreset({ bandKhz: 5, snrDb: 30 })
  assert.equal(match.status, 'ok')
  if (match.status !== 'ok') return
  assert.equal(match.values.bandIndex, 5)
  const snr0Db = match.values.snr0Db
  assert.ok(Math.abs(snr0Db - 36.9897) < 0.001, `snr0Db 应为 36.9897，实际 ${snr0Db}`)
  // 右栏 computeChannel 原文用 toFixed(1) 出结论行，必须与左栏一致。
  assert.equal(channelCapacity(5, snr0Db).toFixed(1), '49.8')

  // 编码/解码往返，再套到该章 defaults 上。
  // 编码时保留四位小数，所以往返比较也用四位口径。
  const spec = { no: 4, values: { bandIndex: 5, snr0Db: Number(snr0Db.toFixed(4)) } }
  const text = encodePreset(spec)
  assert.equal(text, '4:bandIndex=5,snr0Db=36.9897')
  const decoded = decodePreset(text)
  assert.deepEqual(decoded, spec)
  const applied = applyPreset({ bandIndex: 0, snr0Db: 20 }, decoded, 4, ['bandIndex', 'snr0Db'])
  assert.equal(applied.bandIndex, 5)
  assert.equal(Number(applied.snr0Db.toFixed(4)), 36.9897)
})

test('第 4 章：3 kHz 不在档位就报对不上，绝不假对齐', () => {
  const match = channelPreset({ bandKhz: 3, snrDb: 30 })
  assert.equal(match.status, 'no-exact-band')
  if (match.status !== 'no-exact-band') return
  assert.equal(match.asked, 3)
  assert.deepEqual(match.nearest, [2, 5])
  assert.match(bandMissNote(match), /题设 3 kHz 不在本屏档位（最近 2 kHz \/ 5 kHz）/)
  // 非法串一律解码成 null，界面上不报错、继续用默认档。
  assert.equal(decodePreset(''), null)
  assert.equal(decodePreset('4:snr0Db=NaN'), null)
  assert.equal(decodePreset('99:snr0Db=20'), null)
})

test('第 7 章 Eb/N0 与第 12 章级数也给出 preset，且不串到其它章', () => {
  assert.deepEqual(pskPreset({ ebn0Db: 10 }), { ebn0Db: 10 })
  assert.deepEqual(mseqPreset({ stages: 4 }), { level: 0 })
  const spec = { no: 7, values: { ebn0Db: 10 } }
  // 章节号不符、键不在白名单，都必须原样返回 defaults。
  assert.deepEqual(applyPreset({ ebn0Db: 8 }, spec, 12, ['ebn0Db']), { ebn0Db: 8 })
  assert.deepEqual(applyPreset({ ebn0Db: 8 }, spec, 7, ['scheme']), { ebn0Db: 8 })
  assert.deepEqual(applyPreset({ ebn0Db: 8 }, spec, 7, ['ebn0Db']), { ebn0Db: 10 })
})
