import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUSTOM_ABSOLUTE_TOLERANCE,
  CUSTOM_MAX_BITS,
  CUSTOM_RELATIVE_TOLERANCE,
  CUSTOM_STORAGE_KEY,
  createCustomQuestion,
  createSavedRecord,
  formatBer,
  gradeCustomAnswer,
  loadSavedQuestions,
  removeSavedQuestion,
  saveSavedQuestion,
  type CustomQuestion,
  type SavedQuestion,
  type StorageLike,
} from '../src/core/customQuestion.ts'
import { simulateAwgn } from '../src/core/metrics.ts'
import { QAM_ORDERS, orderLabel } from '../src/core/qam.ts'

function makeStorage(): StorageLike & { raw(): string | null } {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
    raw: () => data.get(CUSTOM_STORAGE_KEY) ?? null,
  }
}

function mustCreate(params: { order: number; snrDb: number; sampleBits: number }): CustomQuestion {
  const result = createCustomQuestion(params)
  assert.equal(result.ok, true, `参数应该合法：${JSON.stringify(params)}`)
  if (!result.ok) throw new Error(result.message)
  return result.question
}

function makeQuestion(overrides: Partial<CustomQuestion>): CustomQuestion {
  return {
    order: 16,
    label: '16QAM',
    snrDb: 12,
    sampleBits: 200000,
    symbolCount: 50000,
    bitsPerSymbol: 4,
    seedUsed: 1,
    bitErrors: 10,
    symbolErrors: 10,
    bitCount: 200000,
    ber: 5e-5,
    ser: 5e-5,
    ...overrides,
  }
}

test('四档阶数都能出题，0/20 dB 与 1/200,000 比特的边界照收', () => {
  for (const order of QAM_ORDERS) {
    const question = mustCreate({ order, snrDb: 10, sampleBits: 1000 })
    assert.equal(question.label, orderLabel(order))
    assert.equal(question.bitCount, 1000)
  }

  const oneBit = mustCreate({ order: 2, snrDb: 0, sampleBits: 1 })
  assert.equal(oneBit.symbolCount, 1)
  assert.equal(oneBit.bitCount, 1)

  const maxBits = mustCreate({ order: 64, snrDb: 20, sampleBits: CUSTOM_MAX_BITS })
  assert.equal(maxBits.sampleBits, 200000)
  assert.equal(maxBits.bitCount, 200000)
  assert.equal(maxBits.symbolCount, Math.ceil(200000 / 6))
})

test('非法阶数：3 / 8 / 256 / NaN 都报错，不生成', () => {
  for (const order of [3, 8, 256, Number.NaN]) {
    const result = createCustomQuestion({ order, snrDb: 12, sampleBits: 20000 })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.field, 'order')
      assert.match(result.message, /四档/)
    }
  }
})

test('非法信噪比：-1 / 20.1 / 30 / NaN 都报错', () => {
  for (const snrDb of [-1, 20.1, 30, Number.NaN]) {
    const result = createCustomQuestion({ order: 16, snrDb, sampleBits: 20000 })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.field, 'snrDb')
      assert.match(result.message, /0–20 dB/)
    }
  }
})

test('非法样本量：0 / -5 / 200001 / 1.5 / NaN 都报错', () => {
  for (const sampleBits of [0, -5, 200001, 1.5, Number.NaN]) {
    const result = createCustomQuestion({ order: 16, snrDb: 12, sampleBits })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.field, 'sampleBits')
  }
})

test('同一组参数生成两次，题目逐字段一模一样', () => {
  const params = { order: 16, snrDb: 12, sampleBits: 120000 }
  const first = mustCreate(params)
  const second = mustCreate(params)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('换一个参数，答案必须变；阶数换了也变', () => {
  const base = mustCreate({ order: 16, snrDb: 12, sampleBits: 120000 })
  const louder = mustCreate({ order: 16, snrDb: 12.5, sampleBits: 120000 })
  const qpsk = mustCreate({ order: 4, snrDb: 12, sampleBits: 120000 })
  assert.notEqual(base.ber, louder.ber)
  assert.notEqual(base.ber, qpsk.ber)
})

test('能整除时，ber / bitErrors / ser / symbolErrors 四项与 simulateAwgn 完全相等', () => {
  const question = mustCreate({ order: 16, snrDb: 12, sampleBits: 120000 })
  const reference = simulateAwgn({
    order: 16,
    snrDb: 12,
    symbolCount: 30000,
    seed: 20261027,
    keepSamples: false,
  })

  assert.equal(question.symbolCount, 30000)
  assert.equal(question.bitCount, 120000)
  assert.equal(question.seedUsed, reference.seedUsed)
  assert.equal(question.ber, reference.ber)
  assert.equal(question.bitErrors, reference.bitErrors)
  assert.equal(question.ser, reference.ser)
  assert.equal(question.symbolErrors, reference.symbolErrors)

  // 与固定数值题同一条噪声流：16QAM / 12 dB / 80,000 比特（20,000 个符号）
  // 就是固定题那个 0.0291375，现算比对，不是手抄。
  const fixed = mustCreate({ order: 16, snrDb: 12, sampleBits: 80000 })
  assert.equal(fixed.symbolCount, 20000)
  assert.ok(Math.abs(fixed.ber - 0.0291375) < 1e-12)
})

test('BPSK：一符号一比特，分母等于比特数，SER 等于 BER', () => {
  const question = mustCreate({ order: 2, snrDb: 12, sampleBits: 120000 })
  assert.equal(question.bitCount, 120000)
  assert.equal(question.symbolCount, 120000)
  assert.equal(question.ser, question.ber)
})

test('不整除时最后一个符号只数前 r 位：101 比特 @16QAM 的分母就是 101', () => {
  const question = mustCreate({ order: 16, snrDb: 12, sampleBits: 101 })
  assert.equal(question.symbolCount, 26)
  assert.equal(question.bitCount, 101)
  assert.equal(question.ber, question.bitErrors / 101)
  assert.ok(question.bitErrors <= 101)
})

test('真值为 0 时只认 0：填 1e-5 也算错', () => {
  const question = mustCreate({ order: 2, snrDb: 20, sampleBits: 20000 })
  assert.equal(question.ber, 0)

  const right = gradeCustomAnswer(question, '0')
  assert.equal(right.correct, true)
  assert.equal(right.tolerance, 0)
  assert.match(right.reason, /答案就是 0/)

  for (const wrong of ['1e-5', '0.00001', '0.001']) {
    const grade = gradeCustomAnswer(question, wrong)
    assert.equal(grade.correct, false, `${wrong} 不该算对`)
  }

  const empty = gradeCustomAnswer(question, '')
  assert.equal(empty.correct, false)
  assert.match(empty.reason, /还没填/)
})

test('容差 = max(真值×10%, 1e-5)：贴边算对，超出一丁点算错', () => {
  const question = makeQuestion({ ber: 2e-2 })
  const tolerance = Math.max(2e-2 * CUSTOM_RELATIVE_TOLERANCE, CUSTOM_ABSOLUTE_TOLERANCE)
  const high = question.ber + tolerance
  const low = question.ber - tolerance

  assert.equal(gradeCustomAnswer(question, high).correct, true)
  assert.equal(gradeCustomAnswer(question, low).correct, true)
  assert.equal(gradeCustomAnswer(question, high + 1e-12).correct, false)
  assert.equal(gradeCustomAnswer(question, low - 1e-12).correct, false)
  assert.equal(gradeCustomAnswer(question, 2e-2).correct, true)
})

test('真值很小时绝对底 1e-5 生效：5e-5 ± 1e-5 的两侧', () => {
  const question = makeQuestion({ ber: 5e-5, bitErrors: 10, bitCount: 200000 })
  const inside = gradeCustomAnswer(question, 5e-5 + 0.9e-5)
  const outside = gradeCustomAnswer(question, 5e-5 + 1.1e-5)
  assert.equal(inside.tolerance, CUSTOM_ABSOLUTE_TOLERANCE)
  assert.equal(inside.correct, true)
  assert.equal(outside.correct, false)
})

test('科学计数法、负数、非数字与空答案各有各的说法', () => {
  const question = mustCreate({ order: 4, snrDb: 6, sampleBits: 30000 })
  assert.equal(gradeCustomAnswer(question, question.ber.toExponential(3)).correct, true)
  assert.equal(gradeCustomAnswer(question, formatBer(question.ber)).correct, true)

  const negative = gradeCustomAnswer(question, '-1e-3')
  assert.equal(negative.correct, false)
  assert.match(negative.reason, /负数/)

  const text = gradeCustomAnswer(question, '不是数字')
  assert.equal(text.correct, false)
  assert.match(text.reason, /填一个数字/)

  const empty = gradeCustomAnswer(question, null)
  assert.equal(empty.correct, false)
  assert.match(empty.reason, /还没填/)
})

test('判分是纯函数：判两遍结果一样，不改题目', () => {
  const question = mustCreate({ order: 64, snrDb: 9, sampleBits: 60000 })
  const snapshot = JSON.stringify(question)
  const first = JSON.stringify(gradeCustomAnswer(question, '0.01'))
  const second = JSON.stringify(gradeCustomAnswer(question, '0.01'))
  assert.equal(first, second)
  assert.equal(JSON.stringify(question), snapshot)
})

test('空存档读出空列表，不报错', () => {
  const loaded = loadSavedQuestions(makeStorage())
  assert.deepEqual(loaded.items, [])
  assert.equal(loaded.error, null)
})

test('保存两道题：新的在前，字段原样回来', () => {
  const storage = makeStorage()
  const question = mustCreate({ order: 16, snrDb: 12, sampleBits: 120000 })
  const grade = gradeCustomAnswer(question, formatBer(question.ber))
  const first = createSavedRecord(question, grade.parsed!, true, '2026-10-28T10:00:00.000Z', 'q-1')
  const second = { ...first, id: 'q-2', savedAt: '2026-10-28T10:05:00.000Z', given: 0.5, correct: false }

  assert.equal(saveSavedQuestion(storage, first).ok, true)
  const afterSecond = saveSavedQuestion(storage, second)
  assert.equal(afterSecond.ok, true)
  assert.deepEqual(afterSecond.items.map((item) => item.id), ['q-2', 'q-1'])

  const reloaded = loadSavedQuestions(storage)
  assert.deepEqual(reloaded.items, afterSecond.items)
  assert.equal(reloaded.items[1].truth, question.ber)
  assert.equal(reloaded.items[1].bitCount, 120000)
  assert.equal(reloaded.items[1].given, grade.parsed)
})

test('删除只删那一条，重新读也不会再出现', () => {
  const storage = makeStorage()
  const question = mustCreate({ order: 4, snrDb: 8, sampleBits: 5000 })
  const record = createSavedRecord(question, 0.01, false, '2026-10-28T11:00:00.000Z', 'keep-1')
  const other = createSavedRecord(question, 0.02, false, '2026-10-28T11:01:00.000Z', 'keep-2')
  saveSavedQuestion(storage, record)
  saveSavedQuestion(storage, other)

  const removed = removeSavedQuestion(storage, 'keep-1')
  assert.equal(removed.ok, true)
  assert.deepEqual(removed.items.map((item) => item.id), ['keep-2'])
  assert.deepEqual(loadSavedQuestions(storage).items.map((item) => item.id), ['keep-2'])
})

test('坏 JSON / 非数组：读出空列表并给提示，不抛错', () => {
  const broken = makeStorage()
  broken.setItem(CUSTOM_STORAGE_KEY, '{不是数组')
  const loaded = loadSavedQuestions(broken)
  assert.deepEqual(loaded.items, [])
  assert.match(loaded.error ?? '', /读不出来/)

  const notArray = makeStorage()
  notArray.setItem(CUSTOM_STORAGE_KEY, '{"id":"x"}')
  assert.match(loadSavedQuestions(notArray).error ?? '', /读不出来/)
})

test('坏记录跳过并说明跳了几条，好记录照常留下', () => {
  const storage = makeStorage()
  const good: SavedQuestion = {
    id: 'ok',
    savedAt: '2026-10-28T12:00:00.000Z',
    order: 16,
    snrDb: 12,
    sampleBits: 20000,
    seedUsed: 123,
    bitErrors: 100,
    bitCount: 20000,
    truth: 0.005,
    given: 0.0051,
    correct: true,
  }
  storage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify([good, { id: 'bad' }, null]))
  const loaded = loadSavedQuestions(storage)
  assert.deepEqual(loaded.items, [good])
  assert.match(loaded.error ?? '', /2 条/)
})

test('浏览器不让写时：保存失败有提示，原列表不动', () => {
  const storage = makeStorage()
  const question = mustCreate({ order: 16, snrDb: 12, sampleBits: 20000 })
  const record = createSavedRecord(question, 0.01, false, '2026-10-28T13:00:00.000Z', 'q-1')
  storage.setItem = () => {
    throw new Error('QuotaExceededError')
  }
  const result = saveSavedQuestion(storage, record)
  assert.equal(result.ok, false)
  assert.deepEqual(result.items, [])
  assert.match(result.error ?? '', /不让写/)
})
