import test from 'node:test'
import assert from 'node:assert/strict'

import { fskBandwidth, fskCyclesPerSymbol, fskFootnote, parseDiagram } from '../src/answer/diagram.ts'
import { answerRequestBody, MODEL_TIMEOUT_MS } from '../src/answer/provider.ts'

/** 一份 7-2 口径的 2FSK：2 kBaud，f1 = 4 kHz、f0 = 2 kHz。 */
const fskSpec = {
  kind: 'fsk-time',
  bits: '1011001',
  bitRate: 2000,
  carrierHzLow: 2000,
  carrierHzHigh: 4000,
}

test('请求体三件套：thinking.disabled、model、response_format 必须都在', () => {
  const body = answerRequestBody({
    model: 'deepseek-flash',
    instruction: '看图作答',
    imageUrl: 'data:image/png;base64,AAAA',
  })
  assert.deepEqual(body.thinking, { type: 'disabled' })
  assert.equal(body.model, 'deepseek-flash')
  assert.deepEqual(body.response_format, { type: 'json_object' })
  const messages = body.messages as Array<{ role: string; content: unknown }>
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  const user = messages[1].content as Array<{ type: string }>
  assert.deepEqual(
    user.map((part) => part.type),
    ['text', 'image_url'],
  )
})

test('端点不认 thinking 时能整段去掉，其他字段一个不少', () => {
  const body = answerRequestBody({ model: 'm', instruction: 'x', imageUrl: 'data:', thinking: false })
  assert.equal('thinking' in body, false)
  assert.equal(body.model, 'm')
  assert.deepEqual(body.response_format, { type: 'json_object' })
})

test('等模型的上限放宽到 30 秒', () => {
  assert.equal(MODEL_TIMEOUT_MS, 30_000)
})

test('2FSK 白名单：两个频率都要合规，且 f1 必须高于 f0', () => {
  assert.notEqual(parseDiagram(fskSpec), null)
  assert.equal(parseDiagram({ ...fskSpec, carrierHzHigh: 2000 }), null)
  assert.equal(parseDiagram({ ...fskSpec, carrierHzHigh: 30000 }), null)
  assert.equal(parseDiagram({ ...fskSpec, carrierHzLow: 50 }), null)
})

test('2FSK 底注报 f1 / f0、各自周期数与带宽 6 kHz', () => {
  const spec = parseDiagram(fskSpec)
  assert.notEqual(spec, null)
  if (!spec || spec.kind !== 'fsk-time') return
  assert.deepEqual(fskCyclesPerSymbol(spec), { high: 2, low: 1 })
  assert.equal(fskBandwidth(spec), 6000)
  const note = fskFootnote(spec)
  assert.match(note, /f1 = 4000 Hz/)
  assert.match(note, /f0 = 2000 Hz/)
  assert.match(note, /每码元 2 \/ 1 个周期/)
  assert.match(note, /2R_B = 6 kHz/)
})
