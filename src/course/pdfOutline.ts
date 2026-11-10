/**
 * 从 PDF 里读目录（解析层，没有界面）。
 *
 * 三件事分开做，每件都能单独喂假数据测：
 * 1. 书签树里挑「章级」条目（第N章 / Chapter N），把 4.3、13.2.1 这类节级滤掉；
 * 2. 书签坏了或不认时，退到文字层，只扫前 40 页拼行抓章名；
 * 3. 把抓到的条目对到课程视图的主题上——对不上就是 null，不猜。
 *
 * 调用方注意：pdf.js 会把传进去的 ArrayBuffer 转移走，返回后那份 buffer 就废了；
 * 想二次解析就自己再切一份副本。
 *
 * 两条纪律：
 * - 页码一律是 **PDF 页号**，不做「印刷页 = PDF 页 − 15」这种换算；
 * - pdf.js 只在函数内部动态 import，不进主包；解析完立刻 destroy，不把 doc 留在闭包里。
 */
import { matchChapter } from './match.ts'
import { BOOK_COMMUNICATION } from './syllabus.ts'

/** 目录里的一条：教材原字，加上 PDF 页号（读不出来就是 null）。 */
export type OutlineEntry = {
  rawTitle: string
  page: number | null
}

/**
 * 解析出来的章。`topicId` 可以是 null——目录里那一章在本项目的 13 个仿真里
 * 没有对应实验，如实留空比硬塞一个更像话。
 */
export type OutlinedChapter = {
  /** 从章号里读出来的序号；读不出来是 null。 */
  no: number | null
  rawTitle: string
  topicId: string | null
  page: number | null
}

export type OutlinedBook = {
  id: string
  title: string
  chapters: OutlinedChapter[]
}

/** pdf.js 书签节点的最小形状，只用得上这三个字段。 */
type OutlineNode = {
  title?: unknown
  dest?: unknown
  items?: unknown
}

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

/** 「十」「十一」「二十三」这类中文数字，只处理到两位数够用了。 */
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
 * 从一条书签标题里读出章号。
 *
 * 认两种写法：「第10章 信源编码」（章号与章名之间可能是全角空格，两位数也要认）
 * 和「Chapter 12」。节级编号（4.3、13.2.1）根本不是这两种写法，直接不认。
 */
export function chapterNumberOf(rawTitle: string): number | null {
  const text = rawTitle.trim()
  const cn = /^第\s*([0-9]{1,2}|[零〇一二三四五六七八九十]{1,3})\s*章/.exec(text)
  if (cn) return chineseNumber(cn[1])
  const en = /^chapter\s*(\d{1,2})\b/i.exec(text)
  if (en) return Number(en[1])
  return null
}

/** 这条书签是不是章级条目。 */
export function isChapterTitle(rawTitle: string): boolean {
  return chapterNumberOf(rawTitle) !== null
}

/** 书签树的内部形态：标题 + 原始 dest，dest 要拿 doc 才能换成页码。 */
type ChapterHit = {
  rawTitle: string
  dest: unknown
}

function walkOutline(nodes: unknown, out: ChapterHit[]): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const item = node as OutlineNode
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : ''
    if (rawTitle && isChapterTitle(rawTitle)) {
      out.push({ rawTitle, dest: item.dest ?? null })
    }
    // 章级条目的子项是节，递归下去也不会被认成章，留着无害。
    walkOutline(item.items, out)
  }
}

/**
 * 第一步：从书签树里挑出章级条目。
 *
 * 纯函数：只看树本身，不碰 pdf.js、不读页码，所以页码一律是 null——
 * 页码要拿 doc 解 dest，那是 parsePdfOutline 的活。
 */
export function chapterEntriesFromOutline(nodes: unknown): OutlineEntry[] {
  const hits: ChapterHit[] = []
  walkOutline(nodes, hits)
  return hits.map((hit) => ({ rawTitle: hit.rawTitle, page: null }))
}

/**
 * 第二步（兜底）：从文字层拼出来的行里抓章名。
 *
 * 只认「第N章」「Chapter N」开头的行，同一章只留第一次出现的那行；
 * 一行都没认出来就返回空数组——扫不到不是错误，不该抛异常。
 */
export function chaptersFromTextLines(lines: string[]): OutlineEntry[] {
  const seen = new Set<number>()
  const entries: OutlineEntry[] = []
  for (const line of lines) {
    const text = line.trim()
    const no = chapterNumberOf(text)
    if (no === null || seen.has(no)) continue
    seen.add(no)
    entries.push({ rawTitle: text, page: null })
  }
  return entries
}

/**
 * 第三步：把条目对到课程视图的主题上。
 *
 * 用 R66 的 matchChapter 查表，查不到就留 null。`no` 优先用标题里的章号，
 * 标题读不出章号时退回教材目录里的同名条目。
 */
export function toBook(entries: OutlineEntry[]): OutlinedBook {
  const byTitle = new Map(BOOK_COMMUNICATION.chapters.map((chapter) => [chapter.rawTitle, chapter]))
  const chapters = entries.map<OutlinedChapter>((entry) => {
    const no = chapterNumberOf(entry.rawTitle)
    const matched = matchChapter(entry.rawTitle)
    const handWritten = no === null ? byTitle.get(entry.rawTitle.trim()) : undefined
    return {
      no: no ?? handWritten?.no ?? null,
      rawTitle: entry.rawTitle,
      topicId: matched?.topicId ?? handWritten?.topicId ?? null,
      page: entry.page,
    }
  })
  return {
    id: `${BOOK_COMMUNICATION.id}-pdf`,
    title: BOOK_COMMUNICATION.title,
    chapters,
  }
}

/** 文字层兜底扫多少页。整本 484 页全扫太慢，目录页不会跑到 40 页以后。 */
export const TEXT_SCAN_PAGES = 40

/** pdf.js 模块的最小形状，只用到 getDocument。 */
type PdfjsModule = {
  getDocument: (source: { data: Uint8Array | ArrayBuffer }) => {
    promise: Promise<unknown>
    /** pdf.js 6 起，释放资源走 loadingTask.destroy()，doc 上没有 destroy。 */
    destroy: () => Promise<void>
  }
}

type PdfDocument = {
  getOutline: () => Promise<unknown>
  getDestination: (id: string) => Promise<unknown>
  getPageIndex: (ref: unknown) => Promise<number>
  getTextContent: (params: { pageIndex: number }) => Promise<{ items: Array<{ str?: unknown }> }>
  numPages: number
}

/** 解一个 dest 到 PDF 页号（1 起）。解不出来就是 null，不猜。 */
async function resolvePage(doc: PdfDocument, dest: unknown): Promise<number | null> {
  let target = dest
  if (typeof target === 'string') target = await doc.getDestination(target)
  if (!Array.isArray(target) || target.length === 0) return null
  const index = await doc.getPageIndex(target[0])
  return typeof index === 'number' && Number.isFinite(index) ? index + 1 : null
}

/**
 * 打开一本书，先看书签；书签不可用就退到文字层。doc 一定会被 destroy。
 *
 * 第二个参数是给 Node 探针留的缝：pdf.js 在 Node 下要换成 legacy 构建
 * （现代构建依赖浏览器的 crypto），浏览器里走默认值就行。
 */
export async function parsePdfOutline(
  data: ArrayBuffer,
  loadPdfjs: () => Promise<PdfjsModule> = () => import('pdfjs-dist') as Promise<PdfjsModule>,
): Promise<OutlineEntry[]> {
  // 动态引入：pdf.js 走独立 chunk，主包不因为它变大。
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({ data })
  const doc = (await loadingTask.promise) as unknown as PdfDocument
  try {
    const hits: ChapterHit[] = []
    walkOutline(await doc.getOutline(), hits)
    if (hits.length > 0) {
      const entries: OutlineEntry[] = []
      for (const hit of hits) {
        entries.push({ rawTitle: hit.rawTitle, page: await resolvePage(doc, hit.dest) })
      }
      return entries
    }
    // 书签这条路走不通：只扫前 40 页的文字层。
    const lines: string[] = []
    const pages = Math.min(TEXT_SCAN_PAGES, doc.numPages)
    for (let page = 1; page <= pages; page += 1) {
      const content = await doc.getTextContent({ pageIndex: page - 1 })
      const line = content.items
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .join('')
        .trim()
      if (line) lines.push(line)
    }
    return chaptersFromTextLines(lines)
  } finally {
    // 解析完立刻释放：doc 不留在闭包里，工作线程也一起关掉。
    await loadingTask.destroy()
  }
}
