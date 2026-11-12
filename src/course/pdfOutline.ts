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
  /** 书签层级：0 章、1 节、2 小节。老的调用方不写这个字段，按章处理。 */
  depth?: 0 | 1 | 2
  /** 这一条挂在哪一章下面；章级条目自己就是自己的章号，落在章外的是 null。 */
  chapterNo?: number | null
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
  /** 认到主题时凭的关键词原文，最多三个；认不到就是空数组。 */
  hits: string[]
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
export type OutlineHit = {
  rawTitle: string
  dest: unknown
  /** 0 章、1 节、2 小节——小节之下还往深里嵌的，一律压到 2。 */
  depth: 0 | 1 | 2
  /** 挂在哪一章下面；章级条目自己就是自己的章号，落在章外的是 null。 */
  chapterNo: number | null
}

function walkOutline(nodes: unknown, out: OutlineHit[], parentDepth: number, chapterNo: number | null): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const item = node as OutlineNode
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : ''
    const ownNo = rawTitle ? chapterNumberOf(rawTitle) : null
    // 章靠标题认（第N章 / Chapter N），节与小节靠嵌套层级定，不靠标题里有没有「4.3」。
    const depth: 0 | 1 | 2 = ownNo !== null ? 0 : parentDepth === 0 ? 1 : 2
    const ownChapter = depth === 0 ? ownNo : chapterNo
    if (rawTitle) out.push({ rawTitle, dest: item.dest ?? null, depth, chapterNo: ownChapter })
    walkOutline(item.items, out, depth, ownChapter)
  }
}

/** 「1.2」「1.2.3」这类节编号：给出它属于哪一章、是节还是小节；不是这种写法返回 null。 */
export function sectionNumberOf(rawTitle: string): { chapterNo: number; depth: 1 | 2 } | null {
  const match = /^(\d{1,2})\s*[.．]\s*(\d{1,2})(?:\s*[.．]\s*(\d{1,2}))?/.exec(rawTitle.trim())
  if (!match) return null
  return { chapterNo: Number(match[1]), depth: match[3] === undefined ? 1 : 2 }
}

/**
 * 修一遍归属：真书的书签常常是平的——第1章、1.1、1.1.1 全在同一层。
 *
 * 所以节归哪一章不能只看缩进：标题里写着「5.4.3」就按编号认（这是最硬的证据），
 * 没编号的（「本章小结」「习题」）跟着前面最近的那一章走，开头封面/目录那种落在章外，留 null。
 */
function normalizeHits(hits: OutlineHit[]): OutlineHit[] {
  let lastChapter: number | null = null
  return hits.map((hit) => {
    const ownNo = chapterNumberOf(hit.rawTitle)
    if (ownNo !== null) {
      lastChapter = ownNo
      return { ...hit, depth: 0, chapterNo: ownNo }
    }
    const numbered = sectionNumberOf(hit.rawTitle)
    if (numbered) return { ...hit, depth: numbered.depth, chapterNo: numbered.chapterNo }
    return { ...hit, chapterNo: lastChapter, depth: hit.depth === 0 ? 2 : hit.depth }
  })
}

/**
 * 第一步：从书签树里把三级条目全收下来。
 *
 * 纯函数：只看树本身，不碰 pdf.js、不读页码，所以页码一律是 null——
 * 页码要拿 doc 解 dest，那是 parsePdfOutline 的活。
 */
export function sectionEntriesFromOutline(nodes: unknown): OutlineEntry[] {
  const hits: OutlineHit[] = []
  walkOutline(nodes, hits, -1, null)
  return normalizeHits(hits).map((hit) => ({
    rawTitle: hit.rawTitle,
    page: null,
    depth: hit.depth,
    chapterNo: hit.chapterNo,
  }))
}

/** 只留章级条目——没改签名的那条老路要的还是这一份。 */
export function chapterEntriesFromOutline(nodes: unknown): OutlineEntry[] {
  return sectionEntriesFromOutline(nodes).filter((entry) => (entry.depth ?? 0) === 0)
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
  // 只认章级条目：R90 之后 parsePdfOutline 会把节也一起吐出来，别把节当章。
  const chapters = entries
    .filter((entry) => (entry.depth ?? 0) === 0)
    .map<OutlinedChapter>((entry) => {
      const no = chapterNumberOf(entry.rawTitle)
      const matched = matchChapter(entry.rawTitle)
      const handWritten = no === null ? byTitle.get(entry.rawTitle.trim()) : undefined
      return {
        no: no ?? handWritten?.no ?? null,
        rawTitle: entry.rawTitle,
        topicId: matched?.topicId ?? handWritten?.topicId ?? null,
        hits: matched?.hits ?? [],
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

/** 文字层少到这个程度，就当这本书没有可抓的目录文字（扫描件）。 */
export const MIN_TEXT_CHARS = 50

/** 比 ArrayBuffer 被 transfer 走更早的一道网：调用方一眼能看懂的失败。 */
export class PdfOutlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfOutlineError'
  }
}

/** pdf.js 模块的最小形状，只用到 getDocument 与 worker 配置。 */
type PdfjsModule = {
  getDocument: (source: { data: Uint8Array | ArrayBuffer; disableWorker?: boolean }) => {
    promise: Promise<unknown>
    /** pdf.js 6 起，释放资源走 loadingTask.destroy()，doc 上没有 destroy。 */
    destroy: () => Promise<void>
  }
  GlobalWorkerOptions?: { workerSrc: string }
}

/** 一页的文字层。文本挂在 page 上，doc 上没有按页取文本的捷径。 */
type PdfPage = {
  getTextContent: () => Promise<{ items: Array<{ str?: unknown }> }>
}

type PdfDocument = {
  getOutline: () => Promise<unknown>
  getDestination: (id: string) => Promise<unknown>
  getPageIndex: (ref: unknown) => Promise<number>
  getPage: (pageNumber: number) => Promise<PdfPage>
  numPages: number
}

/** 取一页文字的可注入接口：测试喂假 doc，线上走 pdf.js。 */
export type PageTextLoader = (doc: PdfDocument, pageNumber: number) => Promise<string>

/** 解一个 dest 到 PDF 页号（1 起）。解不出来就是 null，不猜。 */
async function resolvePage(doc: PdfDocument, dest: unknown): Promise<number | null> {
  let target = dest
  if (typeof target === 'string') target = await doc.getDestination(target)
  if (!Array.isArray(target) || target.length === 0) return null
  const index = await doc.getPageIndex(target[0])
  return typeof index === 'number' && Number.isFinite(index) ? index + 1 : null
}

/** 默认取数器：先 getPage(n)，再 page.getTextContent()，一行一页。 */
async function pageText(doc: PdfDocument, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join('')
}

/**
 * 扫前 limit 页的文字层，返回拼好的行与有效字符数。
 * 抽成独立函数是为了能拿假 doc 测：真书多数是扫描件，没法靠它做回归。
 */
export async function scanTextLayer(
  doc: PdfDocument,
  loadPageText: PageTextLoader = pageText,
  limit = TEXT_SCAN_PAGES,
): Promise<{ lines: string[]; chars: number }> {
  const lines: string[] = []
  const pages = Math.min(limit, doc.numPages)
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const line = (await loadPageText(doc, pageNumber)).trim()
    if (line) lines.push(line)
  }
  const chars = lines.reduce((sum, line) => sum + line.replace(/\s+/g, '').length, 0)
  return { lines, chars }
}

/** 文字层结果转章级条目：字符太少就当这本书没有文字层，返回空数组。 */
export function chaptersFromTextLayer(result: { lines: string[]; chars: number }): OutlineEntry[] {
  if (result.chars < MIN_TEXT_CHARS) return []
  return chaptersFromTextLines(result.lines)
}

/** 把 pdf.js 的 worker 指到 Vite 打出来的那个文件；设不上就返回 false 让调用方退主线程。 */
async function attachWorker(pdfjs: PdfjsModule): Promise<boolean> {
  if (!pdfjs.GlobalWorkerOptions || typeof window === 'undefined') return false
  try {
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as { default: string }
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return true
  } catch {
    return false
  }
}

function isPasswordError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'PasswordException'
}

/** 把 pdf.js 的原始异常翻成一句人能看懂的提示，别把 TypeError 弹给用户。 */
function describeError(error: unknown): Error {
  if (error instanceof PdfOutlineError) return error
  if (isPasswordError(error)) {
    return new PdfOutlineError('这本 PDF 加了密码，读不了目录。请换未加密的版本，或者直接手动输章名。')
  }
  return new PdfOutlineError('这本 PDF 读不动：文件可能损坏，或者用了不常见的编码。换一本试试，也可以手动输章名。')
}

/** 一次解析：开书、走书签、书签没有就走文字层。doc 一定会被 destroy。 */
async function readOutline(
  pdfjs: PdfjsModule,
  data: ArrayBuffer,
  loadPageText: PageTextLoader,
  disableWorker: boolean,
): Promise<OutlineEntry[]> {
  const loadingTask = disableWorker
    ? pdfjs.getDocument({ data, disableWorker: true })
    : pdfjs.getDocument({ data })
  let doc: PdfDocument
  try {
    doc = (await loadingTask.promise) as unknown as PdfDocument
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined)
    throw error
  }
  try {
    const hits: OutlineHit[] = []
    walkOutline(await doc.getOutline(), hits, -1, null)
    const ordered = normalizeHits(hits)
    if (ordered.length > 0) {
      const entries: OutlineEntry[] = []
      for (const hit of ordered) {
        entries.push({
          rawTitle: hit.rawTitle,
          page: await resolvePage(doc, hit.dest),
          depth: hit.depth,
          chapterNo: hit.chapterNo,
        })
      }
      return entries
    }
    // 扫描件：书签没有、文字层也抠不出东西。这里认怂，返回空数组让界面走手输。
    return chaptersFromTextLayer(await scanTextLayer(doc, loadPageText))
  } finally {
    // 解析完立刻释放：doc 不留在闭包里，工作线程也一起关掉。
    await loadingTask.destroy()
  }
}

/**
 * 打开一本书，先看书签；书签不可用就退到文字层。doc 一定会被 destroy。
 *
 * 第二、第三个参数是缝：Node 探针要把 pdf.js 换成 legacy 构建（现代构建依赖浏览器
 * 的 crypto）；测试要绕过真书直接喂假 doc。浏览器里两个都走默认值。
 */
export async function parsePdfOutline(
  data: ArrayBuffer,
  loadPdfjs: () => Promise<PdfjsModule> = () => import('pdfjs-dist') as Promise<PdfjsModule>,
  loadPageText: PageTextLoader = pageText,
): Promise<OutlineEntry[]> {
  // 动态引入：pdf.js 走独立 chunk，主包不因为它变大。
  const pdfjs = await loadPdfjs()
  const workerReady = await attachWorker(pdfjs)
  try {
    return await readOutline(pdfjs, data, loadPageText, false)
  } catch (error) {
    if (!workerReady || isPasswordError(error)) throw describeError(error)
    // worker 起不来（被 CSP 挡、workerSrc 没配对）时退到主线程再来一次。
    console.info('pdf.js 的 worker 没起来，已退到主线程解析。')
    let copy: ArrayBuffer
    try {
      copy = data.slice(0)
    } catch {
      throw describeError(error)
    }
    try {
      return await readOutline(pdfjs, copy, loadPageText, true)
    } catch (again) {
      throw describeError(again)
    }
  }
}
