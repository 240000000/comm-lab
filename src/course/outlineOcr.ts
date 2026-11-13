/**
 * 扫描件的目录页识别（R107）。
 *
 * 纯函数，喂文字就能测：先在前 12 页里挑最像目录的一页，再从那一页的文字里
 * 抠「第N章 标题 …… 页码」和「N.N 标题 …… 页码」。页码是**书上印的页码**，
 * 换算成 PDF 页号允许有偏差，界面上先给用户过目确认。
 */
import type { OutlineEntry } from './pdfOutline.ts'

const TOC_HINT = /目\s*录/
const TOC_HINT_EN = /contents/i
const CHAPTER_LINE = /^第\s*([0-9]{1,2}|[一二三四五六七八九十百零〇两]{1,4})\s*章\s*(.+)$/
const SECTION_LINE = /^(\d{1,2}(?:\.\d{1,2}){1,2})\s+(.+)$/
/** 末尾的引导点 + 页码：`…… 12`、`....12`、`·· 130`。 */
const PAGE_TAIL = /^(.*?)[\s.。·…∙•—-]{2,}\s*(\d{1,4})\s*$/

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

/** 「十」「十一」「二十三」这类中文数字，只处理到两位数。 */
function chineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  const tens = /^十([一二三四五六七八九])$/.exec(text)
  if (tens) return 10 + CN_DIGIT[tens[1]]
  const twoTens = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(text)
  if (twoTens) {
    const ones = twoTens[2] ? CN_DIGIT[twoTens[2]] : 0
    return CN_DIGIT[twoTens[1]] * 10 + ones
  }
  if (/^[零〇一二三四五六七八九]$/.test(text)) return CN_DIGIT[text]
  return null
}

/**
 * 前 `limit` 页里哪一页最像目录；返回 **1 起的 PDF 页号**，都不像返回 -1。
 *
 * 打分看三件事：有「目录/Contents」、出现「第N章」的次数、出现「N.N」的次数。
 */
export function findTocPage(pages: string[], limit = 12): number {
  const n = Math.min(limit, Math.max(0, pages.length))
  let best = -1
  let bestScore = 0
  for (let index = 0; index < n; index += 1) {
    const text = pages[index] ?? ''
    let score = 0
    if (TOC_HINT.test(text)) score += 6
    if (TOC_HINT_EN.test(text)) score += 4
    const chapters = text.match(/第\s*[0-9一二三四五六七八九十百零〇两]{1,3}\s*章/g)
    score += Math.min(6, chapters?.length ?? 0)
    const sections = text.match(/(?:^|\n)\s*\d{1,2}\.\d{1,2}\s+\S/g)
    score += Math.min(4, sections?.length ?? 0)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  }
  return bestScore >= 3 ? best + 1 : -1
}

/** 一行里拆出「标题 + 印在书上的页码」；拆不出页码就 page=null。 */
function splitPage(line: string): { title: string; page: number | null } {
  const tail = PAGE_TAIL.exec(line)
  if (tail) {
    const title = tail[1].replace(/[\s.。·…∙•—-]+$/g, '').trim()
    const page = Number(tail[2])
    if (title) return { title, page: Number.isFinite(page) ? page : null }
  }
  return { title: line.trim(), page: null }
}

/** 目录页文字 → 书签同构的条目（depth 0=章、1=节、2=小节）。 */
export function parseTocEntries(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line || line.length < 3) continue
    const chapter = CHAPTER_LINE.exec(line)
    if (chapter) {
      const no = chineseNumber(chapter[1])
      if (no === null) continue
      const { title, page } = splitPage(chapter[2])
      if (!title) continue
      entries.push({ rawTitle: `第 ${no} 章 ${title}`, page, depth: 0, chapterNo: no })
      continue
    }
    const section = SECTION_LINE.exec(line)
    if (section) {
      const { title, page } = splitPage(section[2])
      if (!title) continue
      const parts = section[1].split('.')
      const chapterNo = Number(parts[0])
      entries.push({
        rawTitle: `${section[1]} ${title}`,
        page,
        depth: Math.min(2, Math.max(0, parts.length - 1)) as 1 | 2,
        chapterNo: Number.isFinite(chapterNo) ? chapterNo : null,
      })
    }
  }
  return entries
}

/** 书内页码 → PDF 页号；偏移量由用户的确认表决定，越界就夹回 1。 */
export function printedToPdfPage(printed: number, offset: number): number {
  if (!Number.isFinite(printed)) return 1
  const value = Math.round(printed + offset)
  return value >= 1 ? value : 1
}

/** 给整张表加上 PDF 页号（page 字段换成换算后的页号）。 */
export function mapPrintedPages(entries: OutlineEntry[], offset: number): OutlineEntry[] {
  return entries.map((entry) => ({
    ...entry,
    page: entry.page === null ? null : printedToPdfPage(entry.page, offset),
  }))
}

/** 章名与书内页码的人话摘要，确认表上直接给用户看。 */
export function describeEntry(entry: OutlineEntry): string {
  const page = entry.page === null ? '页码没认出来' : `书内第 ${entry.page} 页`
  return `${entry.rawTitle} → ${page}`
}
