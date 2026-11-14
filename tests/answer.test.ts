import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWER_BANK,
  problemByChapter,
  problemById,
} from '../src/answer/bank.ts'
import { chapterFromTopic, locateProblem } from '../src/answer/locate.ts'
import { defaultProvider } from '../src/answer/provider.ts'
import { channelCapacity, chapterByNo } from '../src/core/course.ts'
import { qFunction } from '../src/core/ber.ts'

/** 取内置题里的某个参数值，取不到就让测试直接失败。 */
function param(id: string, key: string): number {
  const problem = problemById(id)
  assert.ok(problem, `没有内置题 ${id}`)
  const hit = problem.answer.params.find((item) => item.key === key)
  assert.ok(hit, `题目 ${id} 缺参数 ${key}`)
  return hit.value
}

test('内置题：信道容量与 core 的 channelCapacity 复算一致', () => {
  const band = param('capacity', 'bandKhz')
  const snr = param('capacity', 'snr0Db')
  const printed = param('capacity', 'capacityKbit')
  assert.ok(Math.abs(channelCapacity(band, snr) - printed) < 0.02)
})

test('内置题：2PSK 的 Eb/N₀ 代回 Q 函数得到目标误码率', () => {
  const db = param('psk-ebn0', 'ebn0Db')
  const target = param('psk-ebn0', 'targetBer')
  const ber = qFunction(Math.sqrt(2 * 10 ** (db / 10)))
  assert.ok(
    Math.abs(ber - target) / target < 0.03,
    `Eb/N₀ = ${db} dB 时误码率 ${ber}，与目标 ${target} 差得太远`,
  )
})

test('内置题：m 序列周期等于第 12 章实验台的读数', () => {
  const stages = param('mseq-period', 'stages')
  const printed = param('mseq-period', 'period')
  // 题目里的级数换成实验台的 level 下标：MSEO_LEVELS[0] = 4 级
  const view = chapterByNo(12)!.compute!({ level: 0, tau: 0, taps: 0 })
  const readout = view.readouts?.[0]
  assert.ok(readout, '第 12 章 compute 没有返回周期读数')
  assert.match(readout.label, /周期/)
  assert.equal(Number(readout.value), printed)
  assert.equal(printed, 2 ** stages - 1)
})

test('定位：三题的题面各自落到对应章节', () => {
  for (const problem of ANSWER_BANK) {
    const located = locateProblem(problem.prompt)
    assert.ok(located, `${problem.id} 没定位出结果`)
    assert.equal(located.chapter, problem.chapter, `${problem.id} 落到了第 ${located.chapter} 章`)
    assert.ok(located.hits.length > 0, `${problem.id} 一个命中词都没有`)
    assert.equal(problemByChapter(located.chapter)?.id ?? '', problem.id)
  }
})

test('定位：章节号解析与模糊判定可用', () => {
  assert.equal(chapterFromTopic('ch07'), 7)
  assert.equal(chapterFromTopic('ch13'), 13)
  assert.equal(chapterFromTopic('乱码'), 0)

  const vague = locateProblem('这是一道题')
  assert.ok(vague)
  assert.equal(vague.ambiguous, true)
})

test('没配 endpoint 时 provider 返回 offline 而不是抛错', async () => {
  const reply = await defaultProvider({ text: '某题', topicId: 4 })
  assert.deepEqual(reply, { status: 'offline' })
})