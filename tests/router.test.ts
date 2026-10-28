/**
 * 路由解析的单测。
 *
 * parseHash 是纯函数（只吃字符串、不读 window），所以能直接在这里测。
 * 放这三条还有一个用处：证明 npm test 真的在跑 tests/ 下的用例，
 * 而不是像上一轮那样 tests 0 / pass 0 空跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHash } from '../src/router.ts'

test('空 hash 回首页', () => {
  assert.equal(parseHash(''), 'home')
})

test('#/qam 回 qam', () => {
  assert.equal(parseHash('#/qam'), 'qam')
})

test('#/conv 回 conv', () => {
  assert.equal(parseHash('#/conv'), 'conv')
})

test('带尾部斜杠也认得出 #/conv/', () => {
  assert.equal(parseHash('#/conv/'), 'conv')
})

test('#/nope 这种没写的路径也回首页', () => {
  assert.equal(parseHash('#/nope'), 'home')
})

test('#/mission 回 mission', () => {
  assert.equal(parseHash('#/mission'), 'mission')
})

test('#/mission/ 带斜杠也认得出', () => {
  assert.equal(parseHash('#/mission/'), 'mission')
})

test('带查询串的三条实验台路径仍认得出（任务模式回填用）', () => {
  assert.equal(parseHash('#/qam?order=16&snr=12&bits=1000'), 'qam')
  assert.equal(parseHash('#/conv?ebn0=2&bits=12&noise=1'), 'conv')
  assert.equal(parseHash('#/ofdm?cp=16&delay=9&symbols=200'), 'ofdm')
})

test('查询串里出现斜杠也不会把路径判错', () => {
  assert.equal(parseHash('#/qam?order=16&note=a/b'), 'qam')
})
