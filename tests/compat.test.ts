/**
 * R115 / R132：Map 与 WeakMap 的兼容层。
 *
 * pdf.js 6.5.438 每页 render 都用到 getOrInsert / getOrInsertComputed，
 * Chrome 141 两个都没有（本机实测 undefined），所以 src/compat.ts 补上它们。
 * R132 补的是漏掉的一半：pdf.js 里至少 3 处挂在 WeakMap 上（#operatorLists /
 * #pathCaches / #canvasCtxFonts），只补 Map 时翻页会在那几行抛 TypeError。
 * 这里钉住六条：两个方法可调用、已有键不覆盖、键已存在时回调不被调用、
 * 键不存在时回调只调一次且拿到 key 本身，以及 WeakMap 上同样是函数、
 * 且行为一致（未命中回调只调一次并写入、命中不再调）。
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

type WeakMapLike = WeakMap<object, unknown> & {
  getOrInsert?: (key: object, value: unknown) => unknown
  getOrInsertComputed?: (key: object, callback: (key: object) => unknown) => unknown
}

test('WeakMap 上这两个方法同样补成函数', () => {
  const cache = new WeakMap() as WeakMapLike
  assert.equal(typeof cache.getOrInsert, 'function')
  assert.equal(typeof cache.getOrInsertComputed, 'function')
  const key = {}
  assert.equal(cache.getOrInsert?.(key, 'leased'), 'leased')
  assert.equal(cache.getOrInsertComputed?.({}, () => 'computed'), 'computed')
})

test('WeakMap 上未命中回调只调一次并写入，命中后不再调', () => {
  const cache = new WeakMap() as WeakMapLike
  const key = {}
  let calls = 0
  const first = cache.getOrInsertComputed?.(key, (seen) => {
    calls += 1
    assert.equal(seen, key)
    return { state: 'ready' }
  })
  assert.equal(calls, 1)
  assert.equal(cache.get(key), first)
  const second = cache.getOrInsertComputed?.(key, () => {
    calls += 1
    return { state: '不该走到这里' }
  })
  assert.equal(calls, 1)
  assert.equal(second, first)
})
