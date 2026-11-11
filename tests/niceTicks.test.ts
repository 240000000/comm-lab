import assert from 'node:assert/strict'
import { test } from 'node:test'

import { niceTicks } from '../src/labs/niceTicks.ts'

// R64 加横轴刻度时写的纯函数，到 R74 一直没测试。这里只对着返回值断言，不碰 CourseChart。

test('跨度为 0 或负值：只返回一个数，不让下游画出空轴', () => {
  assert.deepEqual(niceTicks(5, 5), [5])
  assert.deepEqual(niceTicks(5, 3), [5])
  assert.deepEqual(niceTicks(-2, -2), [-2])
  assert.equal(niceTicks(5, 5).length, 1)
  // 退化区间返回值必须有限，否则 getImageData 那段坐标换算会变 NaN
  for (const bad of [niceTicks(5, 5), niceTicks(5, 3)]) {
    assert.ok(Number.isFinite(bad[0]))
  }
})

test('跨度 12：步长落在 2.5 档，刻度是 0 / 2.5 / 5 / 7.5 / 10，不许被四舍五入成整数', () => {
  const ticks = niceTicks(0, 12)
  assert.deepEqual(ticks, [0, 2.5, 5, 7.5, 10])
  // 半步不能被抹掉：只要有一根不是整数，说明 2.5 这一档确实留住了
  assert.ok(ticks.some((value) => !Number.isInteger(value)))
  // 相邻差恒等于步长
  for (let i = 1; i < ticks.length; i += 1) {
    assert.ok(Math.abs(ticks[i] - ticks[i - 1] - 2.5) < 1e-9)
  }
})

test('全负区间 −126 到 0：0 自己占一格，最靠近下界的那根是 −125', () => {
  const ticks = niceTicks(-126, 0)
  assert.equal(ticks[ticks.length - 1], 0)
  assert.equal(ticks[0], -125)
  assert.ok(ticks.every((value) => value <= 0))
  assert.ok(ticks.every((value) => Math.abs(value % 25) < 1e-9 || Math.abs(value % 25 - 25) < 1e-9))
  // 升序，不重复
  for (let i = 1; i < ticks.length; i += 1) {
    assert.ok(ticks[i] > ticks[i - 1])
  }
})

test('刻度根数落在 3～9 之间，跨度小到 1e-9 也不许只剩一根', () => {
  const spans: Array<[number, number]> = [
    [0, 1e-9],
    [0, 0.001],
    [0, 0.06],
    [-4, 4],
    [0, 12],
    [-126, 0],
    [0, 500],
    [0, 1e9],
  ]
  for (const [min, max] of spans) {
    const ticks = niceTicks(min, max)
    assert.ok(ticks.length >= 3, `${min}..${max} 只给了 ${ticks.length} 根`)
    assert.ok(ticks.length <= 9, `${min}..${max} 给了 ${ticks.length} 根，太密`)
    // 刻度必须落在区间内（留一点浮点余量），且升序
    assert.ok(ticks[0] >= min - Math.abs(max - min) * 1e-9)
    assert.ok(ticks[ticks.length - 1] <= max + Math.abs(max - min) * 1e-9)
    for (let i = 1; i < ticks.length; i += 1) {
      assert.ok(ticks[i] > ticks[i - 1])
    }
  }
})

test('0 落在区间里时它自己就是一根刻度，不被夹在两根中间', () => {
  for (const [min, max] of [
    [-4, 4],
    [-126, 0],
    [-1, 3],
    [0, 12],
  ] as Array<[number, number]>) {
    const ticks = niceTicks(min, max)
    assert.ok(
      ticks.some((value) => Math.abs(value) < 1e-9),
      `${min}..${max} 的刻度里没有 0：${JSON.stringify(ticks)}`,
    )
  }
})
