/**
 * 从内存里的 PDF 取正文：把 pdf.js 吐出来的 text item 按坐标拼回阅读序的行。
 *
 * 这一层只做「读字」：书签目录仍归 `pdfOutline.ts`，这里不碰它，也不改它。
 * 不引新依赖——用的就是项目已有的 pdfjs-dist；测试在 Node 里换成 legacy 构建，
 * 浏览器里仍走默认构建（`readPdfText` 的第二个参数就是这条缝）。
 */

/** pdf.js `getTextContent()` 里一个 item 的最小形状。 */
export type TextItemLike = {
  str?: unknown
  /** [a, b, c, d, e, f]；e 是横坐标，f 是纵坐标（PDF 用户空间，越往上越大）。 */
  transform?: readonly number[]
}

export type PdfTextPage = {
  getTextContent(): Promise<{ items: TextItemLike[] }>
}

export type PdfTextDocument = {
  numPages: number
  getPage(pageNumber: number): Promise<PdfTextPage>
}

export type DocText = {
  /** 每页一段，行与行之间用 `\n`。 */
  pages: string[]
  totalChars: number
  hasTextLayer: boolean
}

export type PdfLoader = () => Promise<unknown>

/** 书签切节用：标题先由调用方（pdfOutline.ts）解析成页码，这里只收结果。 */
export type OutlineEntry = {
  title: string
  level: number
  startPage: number
}

export type Section = {
  title: string
  level: number
  startPage: number
  text: string
}

/** 同一行的纵坐标抖动容差（磅）。中文字形在同一基线上，通常完全相等。 */
const LINE_TOLERANCE = 0.8
/** 正文层判定的下限：低于这个字符数就当扫描件/纯图 PDF。 */
const MIN_TEXT_LAYER_CHARS = 100
/** 单节正文上限，按用户要求截到 3000 字。 */
export const SECTION_TEXT_LIMIT = 3000

/**
 * 把一个 page 的 text item 拼成行：先按纵坐标聚类，再按横坐标排序。
 * 不依赖 `hasEOL`——这份 PDF 的 item 是逐字吐出来的，坐标比标记可靠。
 */
export function itemsToLines(items: TextItemLike[]): string[] {
  const rows: Array<{ y: number; parts: Array<{ x: number; s: string }> }> = []
  for (const item of items) {
    const s = typeof item.str === 'string' ? item.str : ''
    if (!s) continue
    const transform = Array.isArray(item.transform) ? item.transform : []
    const x = typeof transform[4] === 'number' ? transform[4] : 0
    const y = typeof transform[5] === 'number' ? transform[5] : 0
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= LINE_TOLERANCE)
    if (!row) {
      row = { y, parts: [] }
      rows.push(row)
    }
    row.parts.push({ x, s })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x)
      return row.parts
        .map((part) => part.s)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    })
    .filter((line) => line.length > 0)
}

/** 纯函数：给一个已经打开的 pdf 文档，逐页取正文。 */
export async function extractDocText(pdf: PdfTextDocument): Promise<DocText> {
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(itemsToLines(content.items).join('\n'))
  }
  const totalChars = pages.join('\n').length
  return { pages, totalChars, hasTextLayer: totalChars >= MIN_TEXT_LAYER_CHARS }
}

/**
 * 从内存字节建 pdf 文档并一次读完正文。
 * 返回的 `destroy` 必须在用完后调用——pdf.js 的 worker 是活的。
 */
export async function readPdfText(
  bytes: Uint8Array,
  loadPdfjs: PdfLoader = () => import('pdfjs-dist'),
): Promise<{ text: DocText; destroy: () => Promise<void> }> {
  const pdfjs = (await loadPdfjs()) as {
    getDocument(params: { data: Uint8Array; isEvalSupported?: boolean }): {
      promise: Promise<PdfTextDocument>
      destroy(): Promise<void>
    }
  }
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false })
  const pdf = await task.promise
  try {
    const text = await extractDocText(pdf)
    return { text, destroy: () => task.destroy() }
  } catch (error) {
    await task.destroy()
    throw error
  }
}

function isHeading(line: string): number {
  if (line.length > 40) return 0
  // 目录行的引导点是「……4」或「....4」，正文标题不带。
  if (/…{2,}|\.{4,}/.test(line)) return 0
  if (/^第[0-9一二三四五六七八九十百零〇]+章/.test(line)) return 1
  const match = /^(\d+)((?:\.\d+){1,2})\s+\S/.exec(line)
  if (!match) return 0
  if (Number(match[1]) < 1) return 0
  if (line.includes('。')) return 0
  return 1 + (match[2].match(/\./g)?.length ?? 0)
}

/**
 * 双路切节：给了书签就按书签的「标题 + 页码」切；没给就扫正文标题行
 * （第N章 / N.M / N.M.K 开头、长度小于 40 的行）。
 */
export function splitSections(pages: string[], outline: OutlineEntry[] = []): Section[] {
  if (outline.length > 0) {
    const entries = [...outline].sort((a, b) => a.startPage - b.startPage || a.level - b.level)
    return entries.map((entry, index) => {
      const next = entries[index + 1]
      const endPage = next ? Math.max(entry.startPage, next.startPage - 1) : pages.length
      const text = pages.slice(entry.startPage - 1, endPage).join('\n').slice(0, SECTION_TEXT_LIMIT)
      return { title: entry.title, level: entry.level, startPage: entry.startPage, text }
    })
  }

  const located: Array<{ line: string; page: number }> = []
  pages.forEach((page, index) => {
    for (const raw of page.split('\n')) {
      const line = raw.trim()
      if (line) located.push({ line, page: index + 1 })
    }
  })

  const marks: Array<{ index: number; title: string; level: number; page: number }> = []
  located.forEach((item, index) => {
    const level = isHeading(item.line)
    if (level > 0) marks.push({ index, title: item.line, level, page: item.page })
  })

  return marks.map((mark, index) => {
    const next = marks[index + 1]
    const body = located.slice(mark.index + 1, next ? next.index : located.length).map((item) => item.line)
    return {
      title: mark.title,
      level: mark.level,
      startPage: mark.page,
      text: body.join('\n').slice(0, SECTION_TEXT_LIMIT),
    }
  })
}
