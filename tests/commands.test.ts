import assert from 'node:assert/strict'
import test from 'node:test'
import { SNR_MAX, SNR_MIN, parseCommand } from '../src/core/commands.ts'

test('噪声调大：12 dB 上一档到 13 dB', () => {
  const result = parseCommand('噪声调大一点', { snrDb: 12, order: 16 })
  assert.equal(result.action, 'snr-up')
  assert.equal(result.snrDb, 13)
  assert.match(result.reply, /12 → 13 dB/)
})

test('噪声调小：12 dB 下一档到 11 dB', () => {
  const result = parseCommand('把信噪比调小', { snrDb: 12, order: 16 })
  assert.equal(result.action, 'snr-down')
  assert.equal(result.snrDb, 11)
})

test('夹紧上界：19 dB 再调大是 20，不是 21', () => {
  const result = parseCommand('噪声调大', { snrDb: 19, order: 16 })
  assert.equal(result.action, 'snr-up')
  assert.equal(result.snrDb, SNR_MAX)
  assert.equal(result.snrDb, 20)
})

test('已经在上界：20 dB 再调大仍是 20，并且说明是上限', () => {
  const result = parseCommand('噪声调大', { snrDb: 20, order: 16 })
  assert.equal(result.snrDb, 20)
  assert.match(result.reply, /上限/)
})

test('夹紧下界：0 dB 再调小仍是 0，并且说明到底了', () => {
  const result = parseCommand('噪声调小', { snrDb: 0, order: 16 })
  assert.equal(result.snrDb, SNR_MIN)
  assert.equal(result.snrDb, 0)
  assert.match(result.reply, /到底/)
})

// ---------- 换阶数：真执行，不再拒绝 ----------

test('换成 64：返回 order 动作与目标阶数，回话点明 64QAM 与 6 比特', () => {
  const result = parseCommand('换成 64', { snrDb: 12, order: 16 })
  assert.equal(result.action, 'order')
  assert.equal(result.order, 64)
  assert.equal(result.snrDb, undefined)
  assert.match(result.reply, /64QAM/)
  assert.match(result.reply, /6 比特/)
})

test('换阶数的四种常见说法都能认出来', () => {
  const cases: Array<[string, number]> = [
    ['换成 64QAM', 64],
    ['切到 16qam', 16],
    ['用 4', 4],
    ['64', 64],
    ['把阶数调到 2', 2],
    ['换成 BPSK', 2],
    ['QPSK', 4],
  ]
  for (const [input, order] of cases) {
    const result = parseCommand(input, { snrDb: 12, order: 16 })
    assert.equal(result.action, 'order', `${input} 应该被认成换阶数`)
    assert.equal(result.order, order, `${input} 应该切到 ${order}`)
  }
})

test('已经是这一档：回「没有变」，但仍带 order 动作', () => {
  const result = parseCommand('换成 64', { snrDb: 12, order: 64 })
  assert.equal(result.action, 'order')
  assert.equal(result.order, 64)
  assert.match(result.reply, /没有变/)
})

test('没有的档位：256QAM 明确拒绝，并列出四档，不动参数', () => {
  for (const input of ['换成 256', '换成 256QAM', '调到 8QAM']) {
    const result = parseCommand(input, { snrDb: 12, order: 16 })
    assert.equal(result.action, 'reject')
    assert.equal(result.order, undefined)
    assert.match(result.reply, /BPSK/)
    assert.match(result.reply, /64QAM/)
    assert.match(result.reply, /没有/)
  }
})

test('只说「换阶数」不说目标：追问要哪一档，仍然不动参数', () => {
  const result = parseCommand('换阶数', { snrDb: 12, order: 16 })
  assert.equal(result.action, 'reject')
  assert.equal(result.order, undefined)
  assert.match(result.reply, /哪一档/)
  assert.match(result.reply, /BPSK/)
})

test('「改成 12 dB」不会被当成换阶数', () => {
  const result = parseCommand('改成 12 dB', { snrDb: 16, order: 16 })
  assert.notEqual(result.action, 'order')
  assert.equal(result.order, undefined)
})

test('重跑与重置各自返回对应动作；重置回话写明 16QAM', () => {
  assert.equal(parseCommand('重跑一遍', { snrDb: 7, order: 64 }).action, 'rerun')
  assert.equal(parseCommand('再来一次', { snrDb: 7, order: 64 }).action, 'rerun')
  assert.equal(parseCommand('重置', { snrDb: 7, order: 64 }).action, 'reset')
  assert.match(parseCommand('恢复默认', { snrDb: 7, order: 64 }).reply, /20261027/)
  assert.match(parseCommand('重置', { snrDb: 7, order: 64 }).reply, /16QAM/)
})

test('无效输入不崩，回一句提示', () => {
  for (const input of ['', '   ', '今天天气不错', 'asdf', '!!!']) {
    const result = parseCommand(input, { snrDb: 12, order: 16 })
    assert.equal(result.action, 'reject')
    assert.ok(result.reply.length > 0)
  }
})

test('无论输入什么，返回的信噪比都落在 0–20 的整数上', () => {
  const inputs = ['噪声调大', '噪声调小', '换阶数', '重跑', ' ', '噪声调大 100 档', '换成 64']
  for (const input of inputs) {
    for (const order of [2, 16, 64]) {
      const result = parseCommand(input, { snrDb: 12, order })
      if (result.snrDb !== undefined) {
        assert.ok(Number.isInteger(result.snrDb))
        assert.ok(result.snrDb >= SNR_MIN && result.snrDb <= SNR_MAX)
      }
    }
  }
})

test('解析是纯函数：同一句话同样的状态，回答一样', () => {
  const first = parseCommand('噪声调大', { snrDb: 5, order: 16 })
  const second = parseCommand('噪声调大', { snrDb: 5, order: 16 })
  assert.deepEqual(first, second)
})

test('换阶数也是纯函数：同样的输入与状态返回同样的目标阶数', () => {
  const first = parseCommand('换成 64', { snrDb: 5, order: 4 })
  const second = parseCommand('换成 64', { snrDb: 5, order: 4 })
  assert.deepEqual(first, second)
})
