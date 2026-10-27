/**
 * 卷积码核心的测试（node 自带 test runner，不引第三方框架）。
 *
 * 覆盖用户点名要的五类：
 * 1) 不加噪声必须一位都不错；
 * 2) 手动改几位，纠得回要真的纠得回，纠不回不许写成纠回；
 * 3) 同一颗种子两次跑出来完全一致；
 * 4) 自由距离与纠错能力是算出来的；
 * 5) 软判决必须明显好于硬判决——两条线贴在一起就说明软信息没进度量。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildTrellis,
  correctionCapability,
  decodeHard,
  decodeSoft,
  encodeConvolutional,
  freeDistance,
  sliceHard,
  transmit,
} from '../src/core/conv.ts'
import { createRng } from '../src/core/rng.ts'

const BITS = [0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1]

const berFor = (mode: 'hard' | 'soft', ebN0: number, infoBits: number, seed: number) => {
  const rng = createRng(seed)
  const bits: number[] = []
  for (let i = 0; i < infoBits; i += 1) bits.push(rng.next() > 0.5 ? 1 : 0)
  const coded = encodeConvolutional(bits)
  // 码率 1/2：Es/N0 = Eb/N0 − 3.01 dB。
  const esN0 = ebN0 + 10 * Math.log10(0.5)
  const sigma = Math.sqrt(1 / (2 * Math.pow(10, esN0 / 10)))
  const received = transmit(coded.coded, sigma, rng)
  const decoded =
    mode === 'hard' ? decodeHard(received.map(sliceHard)) : decodeSoft(received)
  let errors = 0
  for (let i = 0; i < bits.length; i += 1) {
    if (decoded[i] !== bits[i]) errors += 1
  }
  return errors / bits.length
}

const flipped = (coded: number[], positions: number[]): number[] => {
  const copy = [...coded]
  for (const index of positions) copy[index] = 1 - copy[index]
  return copy
}

describe('编码器结构', () => {
  it('码字长度是 2 ×（信息比特 + 2 个补零比特）', () => {
    const encoded = encodeConvolutional(BITS)
    assert.equal(encoded.tailBits, 2)
    assert.equal(encoded.coded.length, (BITS.length + 2) * 2)
  })

  it('补零之后码字停在状态 0，这是回溯能唯一的前提', () => {
    const encoded = encodeConvolutional(BITS)
    assert.equal(encoded.statePath.at(-1), 0)
  })

  it('网格有 4 个状态 × 2 种输入 = 8 条边，目标是确定的', () => {
    const edges = buildTrellis()
    assert.equal(edges.length, 8)
    assert.deepEqual(
      edges.map((edge) => `${edge.from}->${edge.to}`),
      ['0->0', '0->2', '1->0', '1->2', '2->1', '2->3', '3->1', '3->3'],
    )
  })

  it('状态 0、输入 1 时吐出 11：u_t ⊕ u_{t-1} ⊕ u_{t-2} 与 u_t ⊕ u_{t-2} 都为 1', () => {
    const edge = buildTrellis().find((item) => item.from === 0 && item.input === 1)
    assert.deepEqual(edge?.out, [1, 1])
  })
})

describe('自由距离与纠错能力', () => {
  it('dfree 搜出来是 5（不是写死的常量）', () => {
    assert.equal(freeDistance().distance, 5)
  })

  it('由 dfree 得到可纠 2 位', () => {
    assert.equal(correctionCapability(freeDistance().distance), 2)
    assert.equal(correctionCapability(3), 1)
    assert.equal(correctionCapability(7), 3)
  })
})

describe('不加噪声', () => {
  it('硬判决与软判决都必须一位不差', () => {
    const encoded = encodeConvolutional(BITS)
    assert.deepEqual(decodeHard(encoded.coded).slice(0, BITS.length), BITS)
    const symbols = encoded.coded.map((bit) => (bit === 0 ? -1 : 1))
    assert.deepEqual(decodeSoft(symbols).slice(0, BITS.length), BITS)
  })

  it('补零译出来也是 0', () => {
    const encoded = encodeConvolutional(BITS)
    const decoded = decodeHard(encoded.coded)
    assert.deepEqual(decoded.slice(BITS.length), [0, 0])
  })
})

describe('手动翻位：纠得回要真纠回，纠不回不许说纠缠回', () => {
  it('翻 1 位：纠回来', () => {
    const encoded = encodeConvolutional(BITS)
    const received = flipped(encoded.coded, [3])
    assert.deepEqual(decodeHard(received).slice(0, BITS.length), BITS)
  })

  it('翻 2 位（互相隔开）：纠回来', () => {
    const encoded = encodeConvolutional(BITS)
    const received = flipped(encoded.coded, [3, 17])
    assert.deepEqual(decodeHard(received).slice(0, BITS.length), BITS)
  })

  it('翻一片 4 位：纠不回来，测试里必须如实断言“不一样”', () => {
    const encoded = encodeConvolutional(BITS)
    const received = flipped(encoded.coded, [12, 13, 14, 15])
    const decoded = decodeHard(received).slice(0, BITS.length)
    assert.notDeepEqual(decoded, BITS, '连续 4 位错误超出了 dfree=5 能分辨的范围，这里就必须是错')
  })
})

describe('可复现性与软判决优势', () => {
  it('同一颗种子、同一个信噪比，两次译码结果逐位相同', () => {
    const first = berFor('soft', 2, 2000, 424242)
    const second = berFor('soft', 2, 2000, 424242)
    assert.equal(first, second)
  })

  it('换一颗种子，数字可以变（不是写死的）', () => {
    const a = berFor('soft', 2, 2000, 424242)
    const b = berFor('soft', 2, 2000, 999)
    assert.notEqual(a, b)
  })

  it('2 dB 上软判决至少比硬判决好一半，否则说明软信息没进度量', () => {
    const hard = berFor('hard', 2, 4000, 20261027)
    const soft = berFor('soft', 2, 4000, 20261027)
    assert.ok(hard > 0, `硬判决在 2 dB 应该出错，实际 ${hard}`)
    assert.ok(
      soft < hard / 2,
      `软判决 ${soft} 相对硬判决 ${hard} 优势不足，软信息可能没进度量`,
    )
  })

  it('高信噪比下两条译码器都基本不出错', () => {
    assert.equal(berFor('hard', 8, 4000, 7), 0)
    assert.equal(berFor('soft', 8, 4000, 7), 0)
  })
})
