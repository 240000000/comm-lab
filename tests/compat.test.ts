/**
 * R115：Map 的兼容层。
 *
 * pdf.js 6.5.438 每页 render 都用到 Map.prototype.getOrInsert / getOrInsertComputed，
 * Chrome 141 两个都没有（本机实测 undefined），所以 src/compat.ts 补上它们。
 * 这里钉住四条：两个方法可调用、已有键不覆盖、键已存在时回调不被调用、
 * 键不存在时回调只调一次且拿到 key 本身。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import '../src/compat.ts'

type MapLike = Map<unknown, unknown> & {
  getOrInsert?: (key: unknown, value: unknown) => unknown
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown
}

test('两个方法在补完之后都存在且可调用', () => {
  const map = new Map() as MapLike
  assert.equal(typeof map.getOrInsert, 'function')
  assert.equal(typeof map.getOrInsertComputed, 'function')
  assert.equal(map.getOrInsert?.('a', 1), 1)
  assert.equal(map.getOrInsertComputed?.('b', (key) => `computed-${String(key)}`), 'computed-b')
})

test('getOrInsert 碰到已有的键不覆盖', () => {
  const map = new Map() as MapLike
  map.set('电源', '旧值')
  assert.equal(map.getOrInsert?.('电源', '新值'), '旧值')
  assert.equal(map.get('电源'), '旧值')
})

test('getOrInsertComputed 的键已存在时一次都不调回调', () => {
  const map = new Map() as MapLike
  map.set('k', '现存')
  let calls = 0
  const value = map.getOrInsertComputed?.('k', () => {
    calls += 1
    return '不该出现的值'
  })
  assert.equal(value, '现存')
  assert.equal(calls, 0)
  assert.equal(map.get('k'), '现存')
})

test('键不存在时回调只调一次，并且拿到 key 本身', () => {
  const map = new Map() as MapLike
  const seen: unknown[] = []
  const value = map.getOrInsertComputed?.('页面', (key) => {
    seen.push(key)
    return `第一次-${String(key)}`
  })
  assert.deepEqual(seen, ['页面'])
  assert.equal(value, '第一次-页面')
  assert.equal(map.get('页面'), '第一次-页面')
})
