/**
 * R106：原文件的身份。
 *
 * 书架上记的目录与 pdfs 里存的 blob 可能不是同一本（换过文件、清过库、旧版本留下的记录）。
 * 这里钉住三件事：空 blob 当「没原件」、页数对不上要显式 mismatch、内置书不写原件。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { closeBook, loadDoc } from '../src/course/pdfSource.ts'
import { DEFAULT_BOOK_ID } from '../src/course/shelf.ts'
import { storePdf } from '../src/course/shelfStore.ts'

function fakeDoc(numPages: number) {
  return {
    numPages,
    getPage: async () => {
      throw new Error('这个用例不该取页')
    },
    destroy: async () => {},
  }
}

test('空 blob 按「没原件」处理，不当成身份不符', async () => {
  const result = await loadDoc('空书', {
    read: async () => ({ bytes: new Uint8Array(0), meta: { numPages: 13, head: '' } }),
    load: async () => {
      throw new Error('空 blob 不该交给 pdf.js')
    },
  })
  // R112：缺原件是一种正常状态，返回 missing，不抛错——界面据此给
  // 「重新导入并勾选保存原文件」，而不是「这本 PDF 打不开」。
  assert.equal(result.status, 'missing')
  await closeBook('空书')

  // 库里根本没有这条记录时同样返回 missing，而不是抛错（R112 一并钉住）。
  const absent = await loadDoc('没这条', { read: async () => null, load: async () => fakeDoc(1) })
  assert.equal(absent.status, 'missing')
  await closeBook('没这条')

  // 解析失败也不留在缓存里：第一次失败，下一次要能重新打开（R112 一并钉住）。
  let reads = 0
  const read = async () => {
    reads += 1
    return { bytes: new Uint8Array([1, 2]), meta: null }
  }
  await assert.rejects(() =>
    loadDoc('坏文件', {
      read,
      load: async () => {
        throw new Error('InvalidPDFException')
      },
    }),
  )
  const second = await loadDoc('坏文件', { read, load: async () => fakeDoc(1) })
  assert.equal(second.status, 'ok', '失败不留在缓存里，下一次要能重新打开')
  assert.equal(reads, 2, '第一次失败后缓存要清掉，否则一次失败会让这本书永远打不开')
  await closeBook('坏文件')
})

test('meta 页数对不上：返回 mismatch，不静默给 document', async () => {
  let destroyed = 0
  const doc = { ...fakeDoc(29), destroy: async () => { destroyed += 1 } }
  const result = await loadDoc('错配书', {
    read: async () => ({ bytes: new Uint8Array([1, 2, 3]), meta: { numPages: 13, head: '通信原理' } }),
    load: async () => doc,
  })
  assert.equal(result.status, 'mismatch')
  if (result.status === 'mismatch') {
    assert.equal(result.expected, 13)
    assert.equal(result.actual, 29)
  }
  assert.equal(destroyed, 1, '对不上就要销毁这份 document，别留在缓存里')
  await closeBook('错配书')
})

test('meta 页数一致：正常返回 document', async () => {
  const doc = fakeDoc(29)
  const result = await loadDoc('对得上的书', {
    read: async () => ({ bytes: new Uint8Array([1]), meta: { numPages: 29, head: '技术报告' } }),
    load: async () => doc,
  })
  assert.equal(result.status, 'ok')
  if (result.status === 'ok') assert.equal(result.doc.numPages, 29)
  await closeBook('对得上的书')
})

test('内置书没有原件：storePdf 直接拒绝，不写库', async () => {
  const result = await storePdf(DEFAULT_BOOK_ID, new Blob([new Uint8Array([1])]), null)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.message, '内置书没有原件')
})
