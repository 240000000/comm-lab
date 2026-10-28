/**
 * 原理短片地址拼接的单测。
 *
 * 线上挂在 /comm-lab/，开发在 /；拼错一个斜杠就是 404，
 * 所以这里把两种 base 与带/不带尾斜杠都钉死。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortFilmLabel, shortFilmUrl } from '../src/core/shortFilm.ts'

test('开发根路径拼出 /shorts/', () => {
  assert.equal(shortFilmUrl('/', 'qam-16qam.mp4'), '/shorts/qam-16qam.mp4')
})

test('线上子路径拼出 /comm-lab/shorts/', () => {
  assert.equal(shortFilmUrl('/comm-lab/', 'qam-16qam.mp4'), '/comm-lab/shorts/qam-16qam.mp4')
})

test('BASE_URL 不带尾斜杠也不出现双斜杠', () => {
  assert.equal(shortFilmUrl('/comm-lab', 'qam-16qam.mp4'), '/comm-lab/shorts/qam-16qam.mp4')
})

test('文件名带前导斜杠也只出现一个', () => {
  assert.equal(shortFilmUrl('/comm-lab/', '/conv-viterbi.mp4'), '/comm-lab/shorts/conv-viterbi.mp4')
  assert.equal(shortFilmUrl('/', '/ofdm-cp.mp4'), '/shorts/ofdm-cp.mp4')
})

test('按钮文案由秒数拼出', () => {
  assert.equal(shortFilmLabel(42), '先看 42 秒原理短片')
  assert.equal(shortFilmLabel(48), '先看 48 秒原理短片')
  assert.equal(shortFilmLabel(52), '先看 52 秒原理短片')
})

test('59 秒原样拼出，不取整成 60', () => {
  assert.equal(shortFilmLabel(59), '先看 59 秒原理短片')
})

test('三个按钮的秒数与文案一一对应', () => {
  const cases: [number, string][] = [
    [42, '先看 42 秒原理短片'],
    [48, '先看 48 秒原理短片'],
    [59, '先看 59 秒原理短片'],
  ]
  for (const [seconds, expected] of cases) {
    assert.equal(shortFilmLabel(seconds), expected)
  }
})
