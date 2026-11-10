#!/usr/bin/env node
/**
 * 拿一本真的 PDF 试一下解析层。
 *
 * 用法：node scripts/probe-pdf.mjs <PDF 路径>
 * 文件不存在时打印「跳过」并以退出码 0 结束——这本书不进仓库，缺了不算失败。
 *
 * Node 下 pdf.js 要用 legacy 构建（现代构建依赖浏览器的 crypto），
 * 所以这里把它当成加载器传进 parsePdfOutline；浏览器里走默认的现代构建。
 * 只读本地文件，不上传、不落盘、不写 localStorage。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePdfOutline, chapterNumberOf, toBook } from '../src/course/pdfOutline.ts'

const target = process.argv[2]
if (!target) {
  console.log('跳过：没有给 PDF 路径。用法 node scripts/probe-pdf.mjs <PDF 路径>')
  process.exit(0)
}

const path = resolve(target)
if (!existsSync(path)) {
  console.log(`跳过：找不到 ${path}`)
  process.exit(0)
}

const legacy = () => import('pdfjs-dist/legacy/build/pdf.mjs')

const bytes = readFileSync(path)
// pdf.js 会把传进去的 ArrayBuffer 转移走（detach），所以每次开书都切一份新的。
const copy = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
console.log(`文件 ${path}`)
console.log(`大小 ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB`)

const pdfjs = await legacy()
const t0 = performance.now()
const task = pdfjs.getDocument({ data: copy() })
const doc = await task.promise
const openMs = performance.now() - t0

const t1 = performance.now()
const outline = await doc.getOutline()
const outlineMs = performance.now() - t1

console.log(`页数 ${doc.numPages}`)
console.log(`书签 ${Array.isArray(outline) ? outline.length : 0} 条（顶层）`)
console.log(`打开 ${openMs.toFixed(0)} ms；取目录 ${outlineMs.toFixed(0)} ms`)
await task.destroy()

const t2 = performance.now()
const entries = await parsePdfOutline(copy(), legacy)
const parseMs = performance.now() - t2

console.log(`章级条目 ${entries.length} 条；解析 + 解页码 ${parseMs.toFixed(0)} ms`)
const book = toBook(entries)
for (const entry of entries) {
  const no = chapterNumberOf(entry.rawTitle)
  const chapter = book.chapters.find((item) => item.rawTitle === entry.rawTitle)
  console.log(
    `  第 ${String(no ?? '?').padStart(2)} 章  PDF 第 ${String(entry.page ?? '?').padStart(3)} 页  ${entry.rawTitle}` +
      `  → 主题 ${chapter?.topicId ?? '未匹配'}`,
  )
}
console.log(`对到课程视图 ${book.chapters.filter((chapter) => chapter.topicId !== null).length} / ${book.chapters.length} 章`)

const rss = process.memoryUsage().rss / 1024 / 1024
console.log(`进程 RSS ${rss.toFixed(0)} MB`)
