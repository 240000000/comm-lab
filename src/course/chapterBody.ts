/**
 * R126：把「正文」送到每一章手里。
 *
 * 两条来源，都标在数据里，界面照实写：
 * - 数字版：文字层按书签的章页码切片，每章留前 3000 字（`SECTION_TEXT_LIMIT`），
 *   整章不进 IndexedDB——算词频用不了那么多。
 * - 扫描版：逐章首页那段 OCR 文本（612–1019 字）直接用；不足 300 字的，
 *   由调用方再 OCR 该章后两页补上，补过的页码写进 `pages`。
 *
 * 纯函数，不碰 pdf.js、不碰 OCR：读文件的活在上层，这里只做切与拼。
 */

import { SECTION_TEXT_LIMIT } from './pdfText.ts'
import type { ChapterBody, ShelfBook, ShelfChapter } from './shelf.ts'

/** 每章最多留这么多字；整章不落盘，算词频够用。 */
export const BODY_TEXT_LIMIT = SECTION_TEXT_LIMIT

/** 扫描版一章首页 OCR 少于这么多字，就算「不够判」，要补后面两页。 */
export const BODY_MIN_OCR_CHARS = 300

function tidy(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, BODY_TEXT_LIMIT)
}

/** 章与下一页的边界：页码排序后，下一章的起始页减一就是本章末页。 */
function pageRanges(chapters: ShelfChapter[], pageCount: number): Map<number, { from: number; to: number }> {
  const starts = chapters
    .filter((chapter) => typeof chapter.page === 'number' && chapter.page >= 1)
    .map((chapter) => ({ key: chapter.no ?? -1, page: chapter.page as number }))
    .sort((a, b) => a.page - b.page)
  const ranges = new Map<number, { from: number; to: number }>()
  starts.forEach((start, index) => {
    const next = starts[index + 1]
    const to = next ? next.page - 1 : pageCount
    ranges.set(start.key, { from: start.page, to: Math.max(start.page, to) })
  })
  return ranges
}

/**
 * 数字版：按章页码切片。章没页码的跳过（不猜它从哪开始，猜错比不认更糟）。
 * 切出来不足 40 字也不留——那多半是整页图，硬算会把章节认歪。
 */
export function attachTextLayer(book: ShelfBook, pages: string[]): ShelfBook {
  const ranges = pageRanges(book.chapters, pages.length)
  return {
    ...book,
    chapters: book.chapters.map((chapter) => {
      const key = chapter.no ?? -1
      const range = ranges.get(key)
      if (!range) return chapter
      const text = tidy(pages.slice(range.from - 1, range.to).join('\n'))
      if (text.length < 40) return chapter
      const body: ChapterBody = {
        text,
        source: 'text-layer',
        pages: `p.${range.from}–${range.to}`,
      }
      return { ...chapter, body }
    }),
  }
}

/** 扫描版：逐章首页 OCR 的产物，`text` 是那一页认出来的字。 */
export type ScanBodyInput = { chapterNo: number; page: number; text?: string }

/**
 * 扫描版：先把首页那段 OCR 挂上。不足 `BODY_MIN_OCR_CHARS` 的章记在返回值里，
 * 由上层再 OCR 后两页，用 `mergeOcrText` 补进去。
 */
export function attachOcrBodies(
  book: ShelfBook,
  scans: ScanBodyInput[],
): { book: ShelfBook; short: number[] } {
  const byNo = new Map(scans.map((scan) => [scan.chapterNo, scan]))
  const short: number[] = []
  const chapters = book.chapters.map((chapter) => {
    if (chapter.no === null) return chapter
    const scan = byNo.get(chapter.no)
    if (!scan) return chapter
    const text = tidy(scan.text ?? '')
    if (text.length === 0) return chapter
    const body: ChapterBody = {
      text,
      source: 'ocr',
      pages: `第 ${scan.page} 页 OCR`,
    }
    if (text.length < BODY_MIN_OCR_CHARS) short.push(chapter.no)
    return { ...chapter, body }
  })
  return { book: { ...book, chapters }, short }
}

/** 补齐：把后两页的 OCR 文本接在首页那段后面，页码改成 `第 42–44 页 OCR`。 */
export function mergeOcrText(book: ShelfBook, chapterNo: number, firstPage: number, extra: string[]): ShelfBook {
  const added = tidy(extra.join('\n'))
  if (added === '') return book
  return {
    ...book,
    chapters: book.chapters.map((chapter) => {
      if (chapter.no !== chapterNo || !chapter.body) return chapter
      const lastPage = firstPage + Math.max(1, extra.length)
      return {
        ...chapter,
        body: {
          text: tidy(`${chapter.body.text}\n${added}`),
          source: 'ocr',
          pages: `第 ${firstPage}–${lastPage} 页 OCR`,
        },
      }
    }),
  }
}