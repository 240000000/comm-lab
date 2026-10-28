/**
 * 三类自定义题的单测：真值必须由现成仿真函数算出来，不是手抄。
 *
 * 这里刻意把「同一组参数算两次」和「和实验台同源」都写成断言：
 * 题目要是换了实现，这几条会先红。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUSTOM_SEED,
  type StorageLike,
} from '../src/core/customQuestion.ts'
import {
  CONV_MAX_INFO_BITS,
  createLabQuestion,
  createSavedLabRecord,
  gradeLabAnswer,
  labHref,
  loadSavedLabQuestions,
  readConvParams,
  readOfdmParams,
  readQamParams,
  removeSavedLabQuestion,
  saveSavedLabQuestion,
  type LabQuestion,
} from '../src/core/labQuestions.ts'
import { runOfdm } from '../src/core/ofdm.ts'
import {
  decodeHard,
  encodeConvolutional,
  sliceHard,
  transmit,
} from '../src/core/conv.ts'
import { createRng } from '../src/core/rng.ts'
import { deriveSeed, simulateAwgn } from '../src/core/metrics.ts'

function mustCreate(kind: 'qam' | 'conv' | 'ofdm', params: Record<string, unknown>): LabQuestion {
  const result = createLabQuestion(kind, params)
  assert.equal(result.ok, true, result.ok ? '' : result.message)
  if (!result.ok) throw new Error(result.message)
  return result.question
}

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
    raw: () => data.get('comm-lab.custom-questions.v1') ?? null,
  }
}

test('QAM 题：比特数能整除时，误码率、错比特数、总数与 simulateAwgn 完全一致', () => {
  const q = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1000 })
  const stats = simulateAwgn({ order: 16, snrDb: 12, symbolCount: 250, seed: CUSTOM_SEED })
  assert.equal(q.truth, stats.ber)
  assert.equal(q.errors, stats.bitErrors)
  assert.equal(q.total, stats.bitCount)
  assert.equal(q.total, 1000)
})

test('QAM 题：比特数不能整除时，分母按比特算，不四舍五入到符号边界', () => {
  const q = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1001 })
  assert.equal(q.total, 1001)
  assert.equal(q.truth, q.errors / 1001)
})

test('卷积题：错比特数与手拼的编码-加噪-硬判决链逐位相等', () => {
  const q = mustCreate('conv', { ebN0: 1, infoBits: 12, noise: true })
  const seedUsed = deriveSeed(CUSTOM_SEED, Math.round(1 * 10) + 12 * 100 + 1)
  const bitRng = createRng(seedUsed)
  const bits: number[] = []
  for (let i = 0; i < 12; i += 1) bits.push(bitRng.next() > 0.5 ? 1 : 0)
  const coded = encodeConvolutional(bits).coded
  const sigma = Math.sqrt(1 / (2 * Math.pow(10, (1 - 10 * Math.log10(2)) / 10)))
  const received = transmit(coded, sigma, createRng(deriveSeed(seedUsed, 12)))
  const decoded = decodeHard(received.map(sliceHard)).slice(0, bits.length)
  let errors = 0
  for (let i = 0; i < bits.length; i += 1) if (decoded[i] !== bits[i]) errors += 1
  assert.equal(q.truth, errors)
  assert.equal(q.total, 12)
  assert.ok(errors > 0, '1 dB 下 12 位应该错至少一位，否则这条断言没意义')
})

test('卷积题：关掉噪声时答案必为 0，分母仍是信息比特数', () => {
  const q = mustCreate('conv', { ebN0: 0, infoBits: 12, noise: false })
  assert.equal(q.truth, 0)
  assert.equal(q.total, 12)
})

test('OFDM 题：错符号数与 runOfdm 的 CP 支路逐数相等，分母是 64×符号数', () => {
  const q = mustCreate('ofdm', { cpLen: 0, delay: 9, symbolCount: 50 })
  const result = runOfdm({ cpLen: 0, delay: 9, symbolCount: 50, seed: CUSTOM_SEED })
  assert.equal(q.truth, result.withCp.symbolErrors)
  assert.equal(q.total, result.withCp.symbolCount)
  assert.equal(q.total, 50 * 64)
  assert.ok(q.truth > 0)
})

test('同参数算两次完全一样；换一个参数，题面与答案至少有一处变', () => {
  const a = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1000 })
  const b = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1000 })
  assert.deepEqual(a, b)
  const c = mustCreate('qam', { order: 64, snrDb: 12, sampleBits: 1000 })
  assert.notEqual(a.prompt, c.prompt)
  assert.notEqual(a.truth, c.truth)
})

test('判分：比率题按 10% / 1e-5 容差，真值 0 时只认 0', () => {
  const q = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1000 })
  assert.equal(gradeLabAnswer(q, String(q.truth)).correct, true)
  assert.equal(gradeLabAnswer(q, (q.truth * 1.09).toString()).correct, true)
  assert.equal(gradeLabAnswer(q, (q.truth * 1.2).toString()).correct, false)

  const zero = { ...q, truth: 0, errors: 0 }
  assert.equal(gradeLabAnswer(zero, '0').correct, true)
  assert.equal(gradeLabAnswer(zero, '1e-6').correct, false)
})

test('判分：计数题按整数精确比对，差 1 也算错，回复带分母', () => {
  const q = mustCreate('conv', { ebN0: 1, infoBits: 12, noise: true })
  const right = gradeLabAnswer(q, String(q.truth))
  assert.equal(right.correct, true)
  assert.match(right.reason, /12 个信息比特/)
  const offByOne = gradeLabAnswer(q, String(q.truth + 1))
  assert.equal(offByOne.correct, false)
  assert.match(offByOne.reason, /差 1 个/)
  assert.equal(gradeLabAnswer(q, '1.5').correct, false)
  assert.equal(gradeLabAnswer(q, '').correct, false)
})

test('非法参数逐项拒绝：阶数 3、卷积 13 位、OFDM CP 25', () => {
  assert.equal(createLabQuestion('qam', { order: 3, snrDb: 12, sampleBits: 1000 }).ok, false)
  assert.equal(
    createLabQuestion('conv', { ebN0: 2, infoBits: CONV_MAX_INFO_BITS + 1, noise: true }).ok,
    false,
  )
  assert.equal(createLabQuestion('conv', { ebN0: 9, infoBits: 12, noise: true }).ok, false)
  assert.equal(createLabQuestion('ofdm', { cpLen: 25, delay: 9, symbolCount: 10 }).ok, false)
  assert.equal(createLabQuestion('ofdm', { cpLen: 16, delay: 41, symbolCount: 10 }).ok, false)
  assert.equal(createLabQuestion('ofdm', { cpLen: 16, delay: 9, symbolCount: 0 }).ok, false)
})

test('题面把单位和分母写清楚：QAM 说比特，OFDM 说符号', () => {
  const qam = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1000 })
  assert.match(qam.prompt, /样本量 1,000 比特/)
  const conv = mustCreate('conv', { ebN0: 2, infoBits: 12, noise: true })
  assert.match(conv.prompt, /信息比特 12 个/)
  assert.match(conv.prompt, /硬判决/)
  const ofdm = mustCreate('ofdm', { cpLen: 16, delay: 9, symbolCount: 200 })
  assert.match(ofdm.prompt, /200 个 OFDM 符号/)
  assert.match(ofdm.prompt, /64 个子载波/)
})

test('跳转地址：三类查询串的键名与实验台读法对得上', () => {
  const qam = mustCreate('qam', { order: 64, snrDb: 8, sampleBits: 1000 })
  assert.equal(labHref(qam), '#/qam?order=64&snr=8&bits=1000')
  assert.deepEqual(readQamParams('#/qam?order=64&snr=8&bits=1000'), {
    order: 64,
    snrDb: 8,
    sampleBits: 1000,
    fromQuery: true,
  })

  const conv = mustCreate('conv', { ebN0: 3.5, infoBits: 8, noise: false })
  assert.equal(labHref(conv), '#/conv?ebn0=3.5&bits=8&noise=0')
  assert.deepEqual(readConvParams('#/conv?ebn0=3.5&bits=8&noise=0'), {
    ebN0: 3.5,
    infoBits: 8,
    noise: false,
    fromQuery: true,
  })

  const ofdm = mustCreate('ofdm', { cpLen: 12, delay: 4, symbolCount: 90 })
  assert.equal(labHref(ofdm), '#/ofdm?cp=12&delay=4&symbols=90')
  assert.deepEqual(readOfdmParams('#/ofdm?cp=12&delay=4&symbols=90'), {
    cpLen: 12,
    delay: 4,
    symbolCount: 90,
    fromQuery: true,
  })
})

test('查询串坏值逐项回落默认，未知键忽略，整串没参数时 fromQuery 为 false', () => {
  assert.deepEqual(readQamParams('#/qam?order=3&snr=99&bits=-5&foo=bar'), {
    order: 16,
    snrDb: 12,
    sampleBits: 20000,
    fromQuery: false,
  })
  assert.deepEqual(readConvParams('#/conv?ebn0=x&bits=13&noise=maybe'), {
    ebN0: 2,
    infoBits: 12,
    noise: true,
    fromQuery: false,
  })
  assert.deepEqual(readOfdmParams('#/ofdm?cp=99&delay=-1&symbols=99999'), {
    cpLen: 16,
    delay: 9,
    symbolCount: 200,
    fromQuery: false,
  })
  assert.equal(readQamParams('#/qam').fromQuery, false)
  assert.equal(readQamParams('#/qam?order=16').fromQuery, true)
})

test('一个字段合法、另一个坏掉时，只回填合法的那一项', () => {
  const q = readQamParams('#/qam?order=64&snr=abc&bits=0')
  assert.equal(q.order, 64)
  assert.equal(q.snrDb, 12)
  assert.equal(q.sampleBits, 20000)
  assert.equal(q.fromQuery, true)
})

test('存档：三类记录都能存、读、删，题型字段原样带回', () => {
  const storage = makeStorage()
  const qam = mustCreate('qam', { order: 16, snrDb: 12, sampleBits: 1000 })
  const conv = mustCreate('conv', { ebN0: 1, infoBits: 12, noise: true })
  const ofdm = mustCreate('ofdm', { cpLen: 0, delay: 9, symbolCount: 50 })

  saveSavedLabQuestion(storage, createSavedLabRecord(qam, qam.truth, true, '2026-10-28T10:00:00.000Z', 'a'))
  saveSavedLabQuestion(storage, createSavedLabRecord(conv, conv.truth, true, '2026-10-28T10:01:00.000Z', 'b'))
  saveSavedLabQuestion(storage, createSavedLabRecord(ofdm, ofdm.truth, true, '2026-10-28T10:02:00.000Z', 'c'))

  const loaded = loadSavedLabQuestions(storage)
  assert.equal(loaded.error, null)
  assert.deepEqual(
    loaded.items.map((item) => item.kind),
    ['ofdm', 'conv', 'qam'],
  )
  assert.deepEqual(loaded.items[2].params, { order: 16, snrDb: 12, sampleBits: 1000 })

  const removed = removeSavedLabQuestion(storage, 'b')
  assert.equal(removed.ok, true)
  assert.deepEqual(
    removed.items.map((item) => item.id),
    ['c', 'a'],
  )
})

test('存档：旧版只有 QAM 字段、没有 kind 的记录按 QAM 读，不丢历史', () => {
  const storage = makeStorage()
  storage.setItem(
    'comm-lab.custom-questions.v1',
    JSON.stringify([
      {
        id: 'old-1',
        savedAt: '2026-10-28T10:00:00.000Z',
        order: 16,
        snrDb: 12,
        sampleBits: 120000,
        seedUsed: 1883523065,
        bitErrors: 3407,
        bitCount: 120000,
        truth: 0.028391666666666666,
        given: 0.0283,
        correct: true,
      },
    ]),
  )
  const loaded = loadSavedLabQuestions(storage)
  assert.equal(loaded.error, null)
  assert.equal(loaded.items.length, 1)
  assert.equal(loaded.items[0].kind, 'qam')
  assert.deepEqual(loaded.items[0].params, { order: 16, snrDb: 12, sampleBits: 120000 })
  assert.equal(loaded.items[0].total, 120000)
  assert.match(loaded.items[0].summary, /16QAM/)
})

test('存档：坏 JSON 不白屏，返回空列表与提示', () => {
  const storage = makeStorage()
  storage.setItem('comm-lab.custom-questions.v1', '{oops')
  const loaded = loadSavedLabQuestions(storage)
  assert.equal(loaded.items.length, 0)
  assert.match(loaded.error ?? '', /读不出来/)
})
