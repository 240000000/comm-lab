/**
 * 原理短片地址拼接的单测。
 *
 * 线上挂在 /comm-lab/，开发在 /；拼错一个斜杠就是 404，
 * 所以这里把两种 base 与带/不带尾斜杠都钉死。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortFilmUrl } from '../src/core/shortFilm.ts'

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
