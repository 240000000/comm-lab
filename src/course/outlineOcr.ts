/**
 * 扫描件的目录页识别（R107）。
 *
 * 纯函数，喂文字就能测：先在前 20 页里挑最像目录的一页，再从目录页附近的几页里
 * 抠「第N章 标题 …… 页码」和「N.N 标题 …… 页码」。页码是**书上印的页码**，
 * 换算成 PDF 页号允许有偏差，界面上先给用户过目确认。
 */
import { TOPICS } from './concepts.ts'
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
export function findTocPage(pages: string[], limit = 20): number {
  const n = Math.min(limit, Math.max(0, pages.length))
  let best = -1
  let bestScore = 0
  for (let index = 0; index < n; index += 1) {
    const text = pages[index] ?? ''
    let score = 0
    const hasToc = TOC_HINT.test(text)
    if (hasToc) score += 8
    if (TOC_HINT_EN.test(text)) score += 4
    const chapters = text.match(/第\s*[0-9一二三四五六七八九十百零〇两]{1,3}\s*章/g)
    score += Math.min(8, (chapters?.length ?? 0) * 2)
    const sections = text.match(/(?:^|\n)\s*\d{1,2}\.\d{1,2}\s+\S/g)
    score += Math.min(6, (sections?.length ?? 0) * 2)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
    // 前 4 页里目录页特征已经很明显，扫描件不用再往后翻。
    if (index < 4 && hasToc && score >= 10) break
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

/**
 * 扫描件目录：按「N.1」节号跨页找每章的开头，章名用本项目 13 个实验的标题。
 *
 * 扫描件里的「第 N 章」经常被认成「第 针 章」「第 $ 章」，标题里的字也常常碎掉
 * （「基带」→「基 带」），靠章号文字抠不出 13 条；但目录里每章的第一条一定是
 * 「N.1」，这一行连同行尾的书内页码几乎总能认对，所以拿它当锚点。
 * maxChapter 默认跟着课程章数走，书里多出来的章（附录之类）不捡。
 */
export function parseTocChapters(
  pages: string[],
  maxChapter: number = TOPICS.length,
): OutlineEntry[] {
  // OCR 会在汉字之间塞空格，也会把「2.1」认成「2. 1」，所以整行先去空白再匹配。
  const lines: string[] = []
  for (const page of pages) {
    for (const raw of page.split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, '')
      // 只写页码的行（「3」）也要留：目录里页码常被挤到下一行。
      if (line.length >= 1) lines.push(line)
    }
  }
  const entries: OutlineEntry[] = []
  for (let no = 1; no <= maxChapter; no += 1) {
    // 前面不能挨着数字或点，后面也不能再跟数字或点：「1.1」要命中，「1.1.1」「12.1」不能。
    const anchor = new RegExp(`(?:^|[^\\d.])0*${no}[.．]1(?![\\d.])`)
    let index = lines.findIndex((line) => anchor.test(line))
    if (index < 0) {
      // 「4.1 信道的…」这一行整行被认坏时，目录里还留着「第 4 章」这一行（章号也可能缺字，
      // 但只要认得出数字就用它兜底）；两条都对不上就不硬凑，宁可在确认表里显示「没认出来」。
      const heading = new RegExp(`第\\s*0*${no}\\s*章`)
      index = lines.findIndex((line) => heading.test(line))
      if (index < 0) {
        // 连「第 N 章」也认坏时（真书里第 4 章就是这样），退一步认这一章的任何小节，
        // 页码会落在章首页附近，确认表里还能改，比整章消失好。
        const anySection = new RegExp(`(?:^|[^\\d.])0*${no}[.．]\\d`)
        index = lines.findIndex((line) => anySection.test(line))
      }
      if (index < 0) continue
    }
    entries.push({
      rawTitle: TOPICS[no - 1].title,
      page: tocPageTail(lines, index, 12),
      depth: 0,
      chapterNo: no,
    })
  }
  // 目录里页码只会往上走：兜底认出来的行常把「88」看丢一位变成「8」，
  // 这种比前一章还小的页码一定是错的，宁可留空让用户在确认表里填。
  let previous = 0
  for (const entry of entries) {
    if (entry.page === null) continue
    if (entry.page <= previous) {
      entry.page = null
      continue
    }
    previous = entry.page
  }
  return entries
}

/**
 * 目录页的样子：一节一条，数字编号很密。正文页里 `N.N` 只是偶尔出现，
 * 所以按「编号个数」挑页，比只认「目录」两个字可靠（扫描件的标题常被认坏）。
 */
export function tocDensePages(pages: string[]): number[] {
  const picked: number[] = []
  pages.forEach((page, index) => {
    const flat = page.replace(/\s+/g, '')
    const numbered = (flat.match(/\d{1,2}[.．]\d/g) ?? []).length
    if (flat.length >= 200 && numbered >= 8) picked.push(index)
  })
  return picked
}

/**
 * 目录条目的书内页码：先看本行尾巴，认不出来就往后再看几行。
 * 扫描件里「1.1」和它的页码常被拆成两行，看得太近会漏（第一章就是这么丢的页码）。
 */
function tocPageTail(lines: string[], index: number, lookahead: number = 3): number | null {
  for (let step = 0; step <= lookahead; step += 1) {
    const line = lines[index + step] ?? ''
    const tail = /(\d{1,3})\s*$/.exec(line)
    if (!tail) continue
    const value = Number(tail[1])
    if (value >= 1 && value <= 999) return value
  }
  return null
}
