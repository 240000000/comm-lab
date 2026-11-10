import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CURVE_SAMPLES,
  SPIRAL_RADIUS,
  SPIRAL_SPAN,
  SPIRAL_TURNS,
  curveHeight,
  curveRadius,
  homeCurvePoint,
  homeCurvePoints,
  phaseAt,
  pointLength,
} from '../src/labs/curvePoints.ts'

// R70：首页左下角那条三维螺旋。只测取点这一层的数学，不测 canvas。

test('螺旋取点都在有限范围内，没有一个坐标是 NaN 或无穷', () => {
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const point = homeCurvePoint(i / CURVE_SAMPLES, 0)
    for (const value of [point.x, point.y, point.z]) {
      assert.equal(Number.isFinite(value), true, `u=${i / CURVE_SAMPLES} 出现了非有限坐标：${value}`)
    }
    // 半径不会缩到 0，也不会鼓成一根针。
    assert.ok(pointLength(point) > 0.2 && pointLength(point) < 2, '模长跑出合理范围')
  }
})

test('参数走满一条螺旋：水平投影回到起点，竖直正好落满 SPAN', () => {
  const head = homeCurvePoint(0, 0.7)
  const tail = homeCurvePoint(1, 0.7)
  // 螺旋不闭合，但在水平面上首尾重合：转过的圈数是整数。
  assert.ok(Math.abs(head.x - tail.x) < 1e-12, 'u=0 与 u=1 的 x 没对上')
  assert.ok(Math.abs(head.z - tail.z) < 1e-12, 'u=0 与 u=1 的 z 没对上')
  assert.ok(Math.abs(head.y - tail.y - SPIRAL_SPAN) < 1e-12, 'u=0 与 u=1 的竖直落程不是 SPAN')

  const points = homeCurvePoints(0.3)
  assert.equal(points.length, CURVE_SAMPLES + 1)
  assert.ok(Math.abs(pointLength(points[0]) - pointLength(points[points.length - 1])) < 1e-12)
})

test('相位只转角度，不改模长，也不改半径与起伏', () => {
  for (let i = 0; i <= 24; i++) {
    const u = i / 24
    const base = pointLength(homeCurvePoint(u, 0))
    for (const phase of [0.4, 1.1, Math.PI, 5.2]) {
      const moved = pointLength(homeCurvePoint(u, phase))
      assert.ok(Math.abs(base - moved) < 1e-9, `u=${u} phase=${phase} 的模长被相位改了`)
      assert.equal(homeCurvePoint(u, phase).y, homeCurvePoint(u, 0).y)
    }
    // 半径与起伏只跟沿曲线的参数有关。
    assert.equal(curveRadius(u), curveRadius(u))
    assert.equal(curveHeight(u), curveHeight(u))
  }

  // 相位转半圈，点应当落到对面：x、z 反号，y 不动。
  const a = homeCurvePoint(0.1, 0)
  const b = homeCurvePoint(0.1, Math.PI)
  assert.ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.z + b.z) < 1e-9)
  assert.ok(Math.abs(a.y - b.y) < 1e-12)
})

test('时间换算成相位按周期线性推进，一圈就是一整周', () => {
  assert.equal(phaseAt(0), 0)
  assert.ok(Math.abs(phaseAt(9000) - Math.PI * 2) < 1e-12)
  assert.ok(Math.abs(phaseAt(4500) - Math.PI) < 1e-12)
  assert.ok(Math.abs(phaseAt(18000, 18000) - Math.PI * 2) < 1e-12)
})

test('螺旋的半径在整条参数区间里恒定，误差不超过 1e-9', () => {
  for (let i = 0; i <= 1000; i++) {
    const point = homeCurvePoint(i / 1000, 1.3)
    assert.ok(
      Math.abs(pointLength(point) - SPIRAL_RADIUS) < 1e-9,
      `u=${i / 1000} 的半径偏了：${pointLength(point)}`,
    )
  }
})

test('相邻两圈的高度差是常数，圈与圈之间落得一样多', () => {
  const drop = SPIRAL_SPAN / SPIRAL_TURNS
  for (let i = 0; i <= 200; i++) {
    const u = (i / 200) * (1 - 1 / SPIRAL_TURNS)
    const upper = homeCurvePoint(u, 0).y
    const lower = homeCurvePoint(u + 1 / SPIRAL_TURNS, 0).y
    assert.ok(Math.abs(upper - lower - drop) < 1e-12, `u=${u} 这一圈的落程不是常数：${upper - lower}`)
  }
})
