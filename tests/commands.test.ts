import assert from 'node:assert/strict'
import test from 'node:test'
import { SNR_MAX, SNR_MIN, parseCommand } from '../src/core/commands.ts'

test('噪声调大：12 dB 上一档到 13 dB', () => {
  const result = parseCommand('噪声调大一点', { snrDb: 12 })
  assert.equal(result.action, 'snr-up')
  assert.equal(result.snrDb, 13)
  assert.match(result.reply, /12 → 13 dB/)
})

test('噪声调小：12 dB 下一档到 11 dB', () => {
  const result = parseCommand('把信噪比调小', { snrDb: 12 })
  assert.equal(result.action, 'snr-down')
  assert.equal(result.snrDb, 11)
})

test('夹紧上界：19 dB 再调大是 20，不是 21', () => {
  const result = parseCommand('噪声调大', { snrDb: 19 })
  assert.equal(result.action, 'snr-up')
  assert.equal(result.snrDb, SNR_MAX)
  assert.equal(result.snrDb, 20)
})

test('已经在上界：20 dB 再调大仍是 20，并且说明是上限', () => {
  const result = parseCommand('噪声调大', { snrDb: 20 })
  assert.equal(result.snrDb, 20)
  assert.match(result.reply, /上限/)
})

test('夹紧下界：0 dB 再调小仍是 0，并且说明到底了', () => {
  const result = parseCommand('噪声调小', { snrDb: 0 })
  assert.equal(result.snrDb, SNR_MIN)
  assert.equal(result.snrDb, 0)
  assert.match(result.reply, /到底/)
})

test('阶数相关：老实回边界说明，不当成能做到', () => {
  for (const input of ['换成 64QAM', '调阶数到 256', '换阶数']) {
    const result = parseCommand(input, { snrDb: 12 })
    assert.equal(result.action, 'reject')
    assert.equal(result.snrDb, undefined)
    assert.match(result.reply, /固定 16QAM/)
    assert.match(result.reply, /还没做/)
  }
})

test('重跑与重置各自返回对应动作', () => {
  assert.equal(parseCommand('重跑一遍', { snrDb: 7 }).action, 'rerun')
  assert.equal(parseCommand('再来一次', { snrDb: 7 }).action, 'rerun')
  assert.equal(parseCommand('重置', { snrDb: 7 }).action, 'reset')
  assert.match(parseCommand('恢复默认', { snrDb: 7 }).reply, /20261027/)
})

test('无效输入不崩，回一句提示', () => {
  for (const input of ['', '   ', '今天天气不错', 'asdf', '!!!']) {
    const result = parseCommand(input, { snrDb: 12 })
    assert.equal(result.action, 'reject')
    assert.ok(result.reply.length > 0)
  }
})

test('无论输入什么，返回的信噪比都落在 0–20 的整数上', () => {
  const inputs = ['噪声调大', '噪声调小', '换阶数', '重跑', ' ', '噪声调大 100 档']
  for (const input of inputs) {
    const result = parseCommand(input, { snrDb: 12 })
    if (result.snrDb !== undefined) {
      assert.ok(Number.isInteger(result.snrDb))
      assert.ok(result.snrDb >= SNR_MIN && result.snrDb <= SNR_MAX)
    }
  }
})

test('解析是纯函数：同一句话同样的状态，回答一样', () => {
  const first = parseCommand('噪声调大', { snrDb: 5 })
  const second = parseCommand('噪声调大', { snrDb: 5 })
  assert.deepEqual(first, second)
})
