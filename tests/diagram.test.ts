import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bitBoundariesMs,
  cyclesPerSymbol,
  diagramFootnote,
  diagramSeconds,
  parseDiagram,
  symbolSeconds,
} from '../src/answer/diagram.ts'

const spec = (bits: string, bitRate: number, carrierHz: number, showBlock = true) => ({
  kind: 'psk-time',
  bits,
  bitRate,
  carrierHz,
  showBlock,
})

test('白名单：不合规的规格一律返回 null，不猜也不补默认值', () => {
  assert.equal(parseDiagram(null), null)
  assert.equal(parseDiagram('psk-time'), null)
  assert.equal(parseDiagram({ ...spec('1011001', 2000, 4000), kind: 'ofdm-eye' }), null)
  // 码元只有 3 位，短于 4 位下限
  assert.equal(parseDiagram(spec('011', 2000, 4000)), null)
  // 不止 0 与 1
  assert.equal(parseDiagram(spec('10a1011', 2000, 4000)), null)
  // 超过 16 位
  assert.equal(parseDiagram(spec('01'.repeat(9), 2000, 4000)), null)
  // 波特率与载波出界
  assert.equal(parseDiagram(spec('1011001', 50, 4000)), null)
  assert.equal(parseDiagram(spec('1011001', 2000, 30000)), null)
  // showBlock 必须是布尔
  assert.equal(parseDiagram({ ...spec('1011001', 2000, 4000), showBlock: 'yes' }), null)
  // 合规的那一份要原样通过
  assert.deepEqual(parseDiagram(spec('1011001', 2000, 4000)), spec('1011001', 2000, 4000))
})

test('码元段数等于比特数：分界点正好落在每个 T_b 的整数倍上', () => {
  const diagram = parseDiagram(spec('1011001', 2000, 4000))
  assert.ok(diagram)
  const boundaries = bitBoundariesMs(diagram)
  // 7 位 ⇒ 8 条边界（含首尾），也就是 7 段
  assert.equal(boundaries.length, diagram.bits.length + 1)
  const symbolMs = symbolSeconds(diagram) * 1000
  for (let index = 0; index < boundaries.length; index += 1) {
    assert.ok(Math.abs(boundaries[index] - index * symbolMs) < 1e-6)
  }
  // 相位分界：第 2 个码元的起点就是 T_b
  assert.equal(boundaries[1], symbolMs)
  assert.equal(diagramSeconds(diagram) * 1000, symbolMs * 7)
})

test('f_c 与 f_b 不是整数倍时，底注切到「不在峰点」', () => {
  const onPeak = parseDiagram(spec('010110', 1200, 2400))
  assert.ok(onPeak)
  // 2400 / 1200 = 2，整数个载波周期
  assert.equal(cyclesPerSymbol(onPeak), 2)
  assert.match(diagramFootnote(onPeak), /f_c·T_b\s*=\s*2/)
  assert.match(diagramFootnote(onPeak), /相位翻转落在峰点/)
  assert.doesNotMatch(diagramFootnote(onPeak), /不在峰点/)

  const offPeak = parseDiagram(spec('010110', 1200, 2500))
  assert.ok(offPeak)
  assert.equal(cyclesPerSymbol(offPeak), null)
  assert.match(diagramFootnote(offPeak), /非整数个载波周期/)
  assert.match(diagramFootnote(offPeak), /相位翻转不在峰点/)
})