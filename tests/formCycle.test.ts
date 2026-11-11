import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FORM_HOLD_A,
  FORM_HOLD_B_END,
  FORM_MORPH,
  FORM_PERIOD,
  formAt,
  smoothstep,
} from '../src/labs/formCycle.ts'

test('形态循环的四个边界：停 A、开始变、停 B、变回', () => {
  // 0 与 4.499 秒都停在形态 A，一帧都不动。
  assert.deepEqual(formAt(0), { from: 'eye', to: 'eye', t: 0 })
  assert.deepEqual(formAt(4499), { from: 'eye', to: 'eye', t: 0 })
  // 4.5 秒那一瞬间刚开始变形，进度还是 0。
  assert.deepEqual({ from: formAt(4500).from, to: formAt(4500).to }, { from: 'eye', to: 'spectrum' })
  assert.equal(formAt(4500).t, 0)
  // 6 秒起停在形态 B，10.5 秒起开始变回。
  assert.deepEqual(formAt(6000), { from: 'spectrum', to: 'spectrum', t: 0 })
  assert.deepEqual(formAt(10500), { from: 'spectrum', to: 'eye', t: 0 })
  // 12 秒一整轮走完，回到形态 A。
  assert.deepEqual(formAt(12000), { from: 'eye', to: 'eye', t: 0 })
})

test('smoothstep：两端导数为零，中点仍是一半', () => {
  assert.equal(smoothstep(0), 0)
  assert.equal(smoothstep(0.5), 0.5)
  assert.equal(smoothstep(1), 1)
  // 3·0.25²−2·0.25³ = 0.1875−0.03125
  assert.equal(smoothstep(0.25), 0.15625)
  // 超界夹紧，不会把进度算成负数或超过 1。
  assert.equal(smoothstep(-3), 0)
  assert.equal(smoothstep(9), 1)
  let last = -1
  for (let i = 0; i <= 20; i += 1) {
    const v = smoothstep(i / 20)
    assert.ok(v >= last, 'smoothstep 必须单调不减')
    last = v
  }
})

test('变形那 1.5 秒里进度严格上升，中点前后不会提前到 1', () => {
  let last = 0
  for (let ms = FORM_HOLD_A; ms < FORM_HOLD_A + FORM_MORPH; ms += 50) {
    const t = formAt(ms).t
    assert.ok(t >= last, '进度不能倒退')
    assert.ok(t <= 1, '进度不能超过 1')
    last = t
  }
  // 4.5+1.5/2 = 5250 ms 处正好一半。
  assert.ok(Math.abs(formAt(FORM_HOLD_A + FORM_MORPH / 2).t - 0.5) < 1e-12)
  assert.ok(formAt(FORM_HOLD_A + FORM_MORPH - 1).t > 0.9, '变形末尾要贴近 1（smoothstep 的尾巴）')
})

test('循环按 12 秒回绕，负时间也落在同一轮里', () => {
  const at = (ms: number) => {
    const s = formAt(ms)
    return `${s.from}-${s.to}-${s.t.toFixed(6)}`
  }
  assert.equal(at(13500), at(1500))
  assert.equal(at(24000), at(0))
  assert.equal(at(24000 + 5500), at(5500))
  // −6000 ms 等价于 6000 ms：停在形态 B。
  assert.equal(at(-6000), at(6000))
  assert.equal(FORM_PERIOD, 12000)
})

test('停住时 from 与 to 相同、进度恒为 0', () => {
  for (let ms = 0; ms < FORM_HOLD_A; ms += 100) {
    const s = formAt(ms)
    assert.equal(s.from, s.to)
    assert.equal(s.t, 0)
  }
  for (let ms = FORM_HOLD_A + FORM_MORPH; ms < FORM_HOLD_B_END; ms += 100) {
    const s = formAt(ms)
    assert.equal(s.from, 'spectrum')
    assert.equal(s.to, 'spectrum')
    assert.equal(s.t, 0)
  }
})
