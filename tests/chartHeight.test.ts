import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  chartHeightFor,
} from '../src/labs/chartHeight.ts'

test('画布高度：窄屏落到 320 的下限', () => {
  assert.equal(chartHeightFor(200), 320)
  assert.equal(chartHeightFor(0), 320)
  assert.equal(chartHeightFor(-50), 320)
})

test('画布高度：802 px 宽时是 337', () => {
  assert.equal(chartHeightFor(802), 337)
})

test('画布高度：宽到 1400 px 就封在 520', () => {
  assert.equal(chartHeightFor(1400), 520)
  assert.equal(chartHeightFor(1920), 520)
  assert.equal(chartHeightFor(4000), CHART_HEIGHT_MAX)
})

test('画布高度：中间段严格递增', () => {
  let prev = chartHeightFor(779)
  for (let width = 780; width <= 1200; width += 20) {
    const h = chartHeightFor(width)
    assert.ok(h > prev, `${width} px 的高度 ${h} 应该比前一档 ${prev} 大`)
    assert.ok(h >= CHART_HEIGHT_MIN && h <= CHART_HEIGHT_MAX)
    prev = h
  }
})