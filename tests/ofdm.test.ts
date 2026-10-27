/**
 * 两径 OFDM 链路的测试。
 * 这里只验证「能不能证明这件事」，不验证具体错多少个——错几个跟种子有关，
 * 写死数字会让测试一碰参数就红。所以断言一律用「为零 / 大于零 / 谁比谁大」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { runOfdm, SUBCARRIERS, decideQpsk, QPSK, MAX_CP, MAX_DELAY } from '../src/core/ofdm.ts'

const SEED = 20261027
const PARAMS = { cpLen: 16, delay: 9, symbolCount: 60, seed: SEED }

test('没有多径时，两条支路都一个符号不错', () => {
  const r = runOfdm({ ...PARAMS, delay: 0 })
  assert.equal(r.withCp.symbolErrors, 0)
  assert.equal(r.noCp.symbolErrors, 0)
  assert.ok(r.withCp.evmPercent < 1e-9, `EVM 应为 0，实际 ${r.withCp.evmPercent}`)
  assert.ok(r.noCp.evmPercent < 1e-9)
})

test('延时 9 在 CP=16 之内：有 CP 一个不错，没 CP 已经出错', () => {
  const r = runOfdm(PARAMS)
  assert.equal(r.withCp.symbolErrors, 0)
  assert.ok(r.noCp.symbolErrors > 0, '没有 CP 时，9 个采样的拖尾应该已经压进数据段')
  assert.ok(r.noCp.evmPercent > r.withCp.evmPercent + 5, '没有 CP 时 EVM 应该明显更大')
})

test('CP 前缀就是数据段最后 cpLen 个采样，原样复制', () => {
  const r = runOfdm(PARAMS)
  const { dry, cpLen } = r.wave
  assert.equal(dry.length, SUBCARRIERS + cpLen)
  for (let n = 0; n < cpLen; n++) {
    const prefix = dry[n]
    const tail = dry[SUBCARRIERS + n]
    assert.ok(Math.abs(prefix - tail) < 1e-12, `第 ${n} 个前缀采样和数据段末尾对不上`)
  }
})

test('延时超过 CP 之后，有 CP 的那条支路也开始出错', () => {
  const inside = runOfdm(PARAMS)
  const outside = runOfdm({ ...PARAMS, delay: 21 })
  assert.equal(inside.withCp.symbolErrors, 0)
  assert.ok(outside.withCp.symbolErrors > 0, '延时 21 > CP 16，应该开始有码间干扰')
  assert.ok(outside.noCp.symbolErrors > outside.withCp.symbolErrors, '没 CP 那边应该错得更多')
  assert.equal(inside.wave.intrudingSamples, 0)
  assert.ok(outside.wave.intrudingSamples > 0, '延时超 CP 后数据段应被拖尾压到')
})

test('同一个种子跑两遍，数字逐位相同；换种子会变', () => {
  const a = runOfdm(PARAMS)
  const b = runOfdm(PARAMS)
  assert.equal(a.withCp.symbolErrors, b.withCp.symbolErrors)
  assert.equal(a.noCp.symbolErrors, b.noCp.symbolErrors)
  assert.equal(a.withCp.evmPercent, b.withCp.evmPercent)
  assert.equal(a.seedUsed, SEED)

  const c = runOfdm({ ...PARAMS, seed: SEED + 1 })
  assert.notEqual(c.withCp.evmPercent, a.withCp.evmPercent)
})

test('CP 长度为 0 时，两条支路就是同一条链路', () => {
  const r = runOfdm({ ...PARAMS, cpLen: 0, delay: 7 })
  assert.equal(r.withCp.symbolErrors, r.noCp.symbolErrors)
  assert.ok(r.noCp.symbolErrors > 0)
})

test('误符号率的分母就是比对的符号数', () => {
  const r = runOfdm(PARAMS)
  assert.equal(r.withCp.symbolCount, SUBCARRIERS * PARAMS.symbolCount)
  assert.equal(r.noCp.symbolCount, SUBCARRIERS * PARAMS.symbolCount)
  assert.equal(r.withCp.ser, r.withCp.symbolErrors / r.withCp.symbolCount)
  assert.equal(r.noCp.ser, r.noCp.symbolErrors / r.noCp.symbolCount)
  assert.equal(r.withCp.constellation.length, SUBCARRIERS)
})

test('参数越界时明确报错', () => {
  assert.throws(() => runOfdm({ ...PARAMS, cpLen: -1 }), /CP 长度必须是/)
  assert.throws(() => runOfdm({ ...PARAMS, cpLen: MAX_CP + 1 }), /CP 长度必须是/)
  assert.throws(() => runOfdm({ ...PARAMS, cpLen: 3.5 }), /CP 长度必须是/)
  assert.throws(() => runOfdm({ ...PARAMS, delay: -1 }), /延时必须是/)
  assert.throws(() => runOfdm({ ...PARAMS, delay: MAX_DELAY + 1 }), /延时必须是/)
  assert.throws(() => runOfdm({ ...PARAMS, symbolCount: 0 }), /符号数必须是正整数/)
})

test('QPSK 判决只看象限，四个理想点各判回自己', () => {
  for (let k = 0; k < QPSK.length; k++) {
    assert.equal(decideQpsk(QPSK[k]), k)
  }
  // 幅度掉一半、整体转过一个角度，只要还在同一个象限里，判决就不变
  assert.equal(decideQpsk({ re: 0.2, im: 0.05 }), 0)
  assert.equal(decideQpsk({ re: -0.2, im: 0.05 }), 1)
  assert.equal(decideQpsk({ re: 0.2, im: -0.05 }), 2)
  assert.equal(decideQpsk({ re: -0.2, im: -0.05 }), 3)
})
