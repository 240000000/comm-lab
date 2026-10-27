/**
 * QAM 星座映射的单测。
 *
 * 只用 Node 自带的 test runner 和 assert，不装任何测试框架。
 * 跑法：npm test（等价于 node --test）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildConstellation, bitsPerSymbol } from '../src/core/qam.ts'
import type { QamPoint } from '../src/core/qam.ts'

const ORDERS = [2, 4, 16, 64]

/** 网格里所有左右相邻、上下相邻的点对。 */
function gridNeighborPairs(points: QamPoint[], side: number): Array<[QamPoint, QamPoint]> {
  const pairs: Array<[QamPoint, QamPoint]> = []
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const index = row * side + col
      if (col + 1 < side) pairs.push([points[index], points[index + 1]])
      if (row + 1 < side) pairs.push([points[index], points[index + side]])
    }
  }
  return pairs
}

/** 两个等长比特串有多少位不同。 */
function bitDiff(a: string, b: string): number {
  let count = 0
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] !== b[k]) count += 1
  }
  return count
}

// ---------- 点数 ----------

test('2 阶（BPSK）有 2 个点', () => {
  assert.equal(buildConstellation(2).length, 2)
})

test('4 阶有 4 个点', () => {
  assert.equal(buildConstellation(4).length, 4)
})

test('16 阶有 16 个点', () => {
  assert.equal(buildConstellation(16).length, 16)
})

test('64 阶有 64 个点', () => {
  assert.equal(buildConstellation(64).length, 64)
})

// ---------- 平均能量归一化为 1 ----------

for (const order of ORDERS) {
  test(`${order} 阶的平均符号能量等于 1`, () => {
    const points = buildConstellation(order)
    let sum = 0
    for (const p of points) {
      sum += p.i * p.i + p.q * p.q
    }
    const meanEnergy = sum / points.length
    assert.ok(
      Math.abs(meanEnergy - 1) < 1e-12,
      `平均能量应为 1，实际是 ${meanEnergy}`,
    )
  })
}

// ---------- 标签唯一且位宽正确 ----------

for (const order of ORDERS) {
  test(`${order} 阶的 ${order} 个标签互不重复，位宽等于 bitsPerSymbol`, () => {
    const points = buildConstellation(order)
    const labels = points.map((p) => p.bits)
    assert.equal(new Set(labels).size, order, '标签出现了重复')
    for (const label of labels) {
      assert.equal(label.length, bitsPerSymbol(order), `标签 ${label} 位宽不对`)
      assert.match(label, /^[01]+$/, `标签 ${label} 含非二进制字符`)
    }
  })
}

// ---------- 格雷码：相邻点只差一位 ----------

for (const order of [4, 16, 64]) {
  test(`${order} 阶网格里左右/上下相邻的点，标签只差一位`, () => {
    const points = buildConstellation(order)
    const side = Math.round(Math.sqrt(order))
    const pairs = gridNeighborPairs(points, side)
    assert.equal(pairs.length, 2 * side * (side - 1), '邻居点对数量不对')
    for (const [a, b] of pairs) {
      assert.equal(bitDiff(a.bits, b.bits), 1, `${a.bits} 与 ${b.bits} 差的不止一位`)
    }
  })
}

// ---------- 非法阶数 ----------

test('非法阶数一律抛 RangeError，不返回空数组', () => {
  const bad = [0, 3, 8, -4, 2.5, Number.NaN]
  for (const order of bad) {
    assert.throws(() => buildConstellation(order), RangeError, `阶数 ${order} 应该抛错`)
    assert.throws(() => bitsPerSymbol(order), RangeError, `bitsPerSymbol(${order}) 应该抛错`)
  }
})

// ---------- 可重复 ----------

test('同一阶数连调两次，返回的顺序与数值完全一致', () => {
  for (const order of ORDERS) {
    assert.equal(
      JSON.stringify(buildConstellation(order)),
      JSON.stringify(buildConstellation(order)),
    )
  }
})

// ---------- bitsPerSymbol ----------

test('bitsPerSymbol 的对应关系是 2→1、4→2、16→4、64→6', () => {
  assert.equal(bitsPerSymbol(2), 1)
  assert.equal(bitsPerSymbol(4), 2)
  assert.equal(bitsPerSymbol(16), 4)
  assert.equal(bitsPerSymbol(64), 6)
})
