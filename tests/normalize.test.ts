import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeOcrText } from '../src/course/normalize.ts'

test('汉字之间的空白全部删掉', () => {
  assert.equal(normalizeOcrText('信 道 容 量 为 多 少'), '信道容量为多少')
  assert.equal(normalizeOcrText('带 宽 为 3 kHz'), '带宽为 3 kHz')
})

test('中英之间留一个空格，拉丁字母内部的空格不粘连', () => {
  assert.equal(normalizeOcrText('信噪比S/N  是 30 dB'), '信噪比 S/N 是 30 dB')
  assert.equal(normalizeOcrText('Eb/N0 与 Q(·) 都 不 能 粘'), 'Eb/N0 与 Q(·) 都不能粘')
})

test('连续空白压成一个，空行合并，行首行尾不留空白', () => {
  assert.equal(normalizeOcrText('  第一行  \n\n\n  第二行   '), '第一行\n第二行')
  assert.equal(normalizeOcrText('C = B·log₂(1 + S/N)'), 'C = B·log₂(1 + S/N)')
})
