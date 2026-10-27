/**
 * DFT / IDFT 的测试：先对定义，再对往返还原。
 * 这一版是按公式硬算的，所以测试也只认公式，不认任何「快速算法应该满足」的东西。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { dft, idft, type Complex } from '../src/core/dft.ts'

function round(value: number): number {
  return Math.round(value * 1e12) / 1e12
}

test('一个单位冲激变换后是平的（每个频点都是 1）', () => {
  const x: Complex[] = Array.from({ length: 8 }, (_, i) => ({ re: i === 0 ? 1 : 0, im: 0 }))
  const X = dft(x)
  for (const bin of X) {
    assert.ok(Math.abs(bin.re - 1) < 1e-12)
    assert.ok(Math.abs(bin.im) < 1e-12)
  }
})

test('直流信号只落在 0 号频点，值是 N', () => {
  const n = 16
  const x: Complex[] = Array.from({ length: n }, () => ({ re: 1, im: 0 }))
  const X = dft(x)
  assert.equal(round(X[0].re), n)
  for (let k = 1; k < n; k++) {
    assert.ok(Math.abs(X[k].re) < 1e-9)
    assert.ok(Math.abs(X[k].im) < 1e-9)
  }
})

test('IFFT 再 FFT 能还原（64 点，误差小于 1e-9）', () => {
  const freq: Complex[] = Array.from({ length: 64 }, (_, k) => ({
    re: Math.cos((2 * Math.PI * 3 * k) / 64) + 0.4 * Math.sin((2 * Math.PI * 11 * k) / 64),
    im: 0.7 * Math.cos((2 * Math.PI * 5 * k) / 64) - Math.sin((2 * Math.PI * 17 * k) / 64),
  }))
  const back = dft(idft(freq))
  for (let k = 0; k < 64; k++) {
    assert.ok(Math.abs(back[k].re - freq[k].re) < 1e-9, `第 ${k} 个频点实部没还原`)
    assert.ok(Math.abs(back[k].im - freq[k].im) < 1e-9, `第 ${k} 个频点虚部没还原`)
  }
})

test('两点变换退化成加减法', () => {
  const X = dft([
    { re: 1, im: 0 },
    { re: 0, im: 0 },
  ])
  assert.deepEqual(
    X.map((p) => [round(p.re), round(p.im)]),
    [
      [1, 0],
      [1, 0],
    ],
  )
})

test('长度不是 2 的幂（或小于 2）时明确报错', () => {
  for (const n of [0, 1, 3, 6, 100]) {
    const x: Complex[] = Array.from({ length: n }, () => ({ re: 0, im: 0 }))
    assert.throws(() => dft(x), /DFT 长度必须是 2 的幂/)
    assert.throws(() => idft(x), /IDFT 长度必须是 2 的幂/)
  }
})
