/**
 * 书架：课程视图这一屏背后「现在用的是哪本书」。
 *
 * 一本书 = 标题 + 一列章。每章记四样：目录上的章号、原字标题、认到的主题、
 * 认出来时凭的哪几个词。这四样足够把「为什么这章能玩、那章不能玩」摊开讲清楚，
 * 也多一个字都不留。R93 起目录会存进浏览器的 IndexedDB（见 shelfDb.ts），
 * 这里仍然只是数据与纯函数：不碰 DOM、不碰 `localStorage`、不读文件。
 */

import { chapterByNo } from '../core/course.ts'
import { MIN_MARGIN, MIN_SCORE } from '../answer/locate.ts'
import { bodyHitsLine, scoreBody, scoreTopic, type BodyScore } from './concepts.ts'
import type { OutlinedBook, OutlineEntry } from './pdfOutline.ts'
import { assignTopics, groupSections } from './sections.ts'
import { BOOK_COMMUNICATION } from './syllabus.ts'

/** 一章的正文摘要：这一轮判定功能覆盖，看的就是它。 */
export type ChapterBody = {
  /** 最多 3000 字；整章不落盘，够算词频就行。 */
  text: string
  /** 正文从哪来——文字层还是 OCR，界面照实写，不把 OCR 说成文字层。 */
  source: 'text-layer' | 'ocr'
  /** 证据的页码：数字版写页码范围 p.79–84，扫描版写第 N 页 OCR。 */
  pages: string
}

/** 书架上的一章：目录上长什么样，以及它认到了哪一章。 */
export type ShelfChapter = {
  /** 目录上的章号，读不出来是 null。 */
  no: number | null
  /** 目录上的原字标题。 */
  rawTitle: string
  /** 认到的主题标识（= course.ts 里那一章的 no），认不到是 null。 */
  topicId: string | null
  /** 认出来时凭的关键词，最多三个；认不到就是空数组。 */
  hits: string[]
  /** 这一章是靠哪几条节名认出来的（R90）；章名认的章没有这个字段。 */
  sectionHits?: string[]
  /** 这一章在 PDF 里的起始页；导入时从书签读，读不出来是 null。 */
  page?: number | null
  /** R126：这一章的正文摘要，没读过正文的书没有这一项。 */
  body?: ChapterBody
}

/** 书架上的一本书。 */
export type ShelfBook = {
  id: string
  title: string
  chapters: ShelfChapter[]
}

/** 默认那本书的 id：内置书不许删，切换时也靠它认回默认。 */
export const DEFAULT_BOOK_ID = BOOK_COMMUNICATION.id

/** 默认那本书在界面上怎么写。教材原名只有一个「通信原理」，版本号是给人看的。 */
export const DEFAULT_SHELF_TITLE = '通信原理（第 7 版）'

/** 认不到主题的章，标题后面跟这一句。 */
export const MISSING_MATCH = '未识别到对应模型'

/** 没覆盖的章统一一句话说清，不写「即将支持」这类空头支票。 */
export const UNCOVERED_NOTE =
  '本书这部分暂未覆盖，识别不出来的章不提供只能看的假仿真。'

/** 账单：这本书一共几章、几章能玩、剩下几章不能。 */
export type ShelfBill = {
  total: number
  playable: number
  uncovered: number
}

/** 默认书架：内置那本《通信原理》，13 章都是手写的，所以没有命中证据。 */
export function defaultShelfBook(): ShelfBook {
  return {
    id: BOOK_COMMUNICATION.id,
    title: DEFAULT_SHELF_TITLE,
    chapters: BOOK_COMMUNICATION.chapters.map((chapter) => ({
      no: chapter.no,
      rawTitle: chapter.rawTitle,
      topicId: chapter.topicId,
      hits: [],
    })),
  }
}

/** 把刚解析出来的目录包成书架上的一本。 */
export function bookFromOutline(title: string, outline: OutlinedBook, id: string): ShelfBook {
  return {
    id,
    title,
    chapters: outline.chapters.map((chapter) => ({
      no: chapter.no,
      rawTitle: chapter.rawTitle,
      topicId: chapter.topicId,
      hits: chapter.hits,
      page: chapter.page,
    })),
  }
}

/**
 * R90 的新路：从三级目录条目包成书架上的一本。
 *
 * 归属规则全在 sections.ts 里（节名投票 ≥2 条才算、否则退章名），这里只做搬运，
 * 所以「凭什么认这一章」和「怎么裁决抢主题」两件事在测试里能分开钉。
 */
export function bookFromSections(title: string, entries: OutlineEntry[], id: string): ShelfBook {
  const pages = chapterPages(entries)
  return {
    id,
    title,
    chapters: assignTopics(groupSections(entries)).map((chapter) => ({
      no: chapter.no,
      rawTitle: chapter.rawTitle,
      topicId: chapter.topicId,
      hits: chapter.hits,
      sectionHits: chapter.sectionHits,
      page:
        pages.get(chapter.no === null ? `title:${chapter.rawTitle}` : `no:${chapter.no}`) ?? null,
    })),
  }
}

/** 章级条目的页码表：有章号按章号，没章号按原字标题。 */
function chapterPages(entries: OutlineEntry[]): Map<string, number> {
  const pages = new Map<string, number>()
  for (const entry of entries) {
    if ((entry.depth ?? 0) !== 0) continue
    if (typeof entry.page !== 'number' || entry.page < 1) continue
    const key =
      entry.chapterNo === null || entry.chapterNo === undefined
        ? `title:${entry.rawTitle}`
        : `no:${entry.chapterNo}`
    if (!pages.has(key)) pages.set(key, entry.page)
  }
  return pages
}

/** 这一章对应的是不是真有一屏能玩（主题存在且 course.ts 里确实有那一章）。 */
export function isPlayable(chapter: ShelfChapter): boolean {
  if (!chapter.topicId) return false
  return chapterByNo(Number(chapter.topicId)) !== undefined
}

/** 数账单。总数、能玩的、剩下的——三个数加起来必须等于总数。 */
export function billOf(book: ShelfBook): ShelfBill {
  const playable = book.chapters.filter(isPlayable).length
  return {
    total: book.chapters.length,
    playable,
    uncovered: book.chapters.length - playable,
  }
}

/**
 * 一章的匹配证据，直接可以印在账单上。
 *
 * 认到的写「→ 章节名，命中「词」「词」」，节名认的写「→ 章节名，节名命中「5.4.3 小信噪比…」」——
 * 后者才是这一轮想要的：评审查得到底是哪一节把它认出来的。
 * 认不到的只写一句「未识别到对应模型」，不猜「大概是第几章」，猜错比不认更糟。
 */
export function evidenceOf(chapter: ShelfChapter): string {
  if (!isPlayable(chapter)) return MISSING_MATCH
  const topic = chapterByNo(Number(chapter.topicId))!
  const sectionWords = (chapter.sectionHits ?? []).map((word) => `「${word}」`).join('')
  if (sectionWords) return `→ ${topic.title}，节名命中${sectionWords}`
  const words = chapter.hits.map((word) => `「${word}」`).join('')
  return words ? `→ ${topic.title}，命中${words}` : `→ ${topic.title}`
}

/** 书架里加一本；同 id 的旧书换掉（重新导入同一份文件不该出现两条）。 */
export function addBook(shelf: ShelfBook[], book: ShelfBook): ShelfBook[] {
  const rest = shelf.filter((item) => item.id !== book.id)
  return [...rest, book]
}

/** 从书架里移除一本；默认那本不许删，书架上至少留一本。 */
export function removeBook(shelf: ShelfBook[], id: string): ShelfBook[] {
  if (id === BOOK_COMMUNICATION.id) return shelf
  const rest = shelf.filter((item) => item.id !== id)
  return rest.length > 0 ? rest : shelf
}

/** 按 id 取书；id 不在书架上就退回第一本，保证界面上永远有一本可用。 */
export function bookById(shelf: ShelfBook[], id: string | null): ShelfBook {
  const found = id ? shelf.find((item) => item.id === id) : undefined
  return found ?? shelf[0]
}

/** 页码夹紧：任何来源的页码都落到 1..pageCount。 */
export function clampPage(page: number, pageCount: number): number {
  const total = Math.max(1, Math.floor(Number.isFinite(pageCount) ? pageCount : 1))
  if (!Number.isFinite(page)) return 1
  return Math.min(total, Math.max(1, Math.round(page)))
}

/** 章到页：这一章在 PDF 里的起始页；没有记录就给 1（真正的夹紧在 PdfPane 里按 numPages 做）。 */
export function chapterPage(book: ShelfBook, no: number | null): number {
  if (no === null) return 1
  const chapter = book.chapters.find((item) => item.topicId === String(no) || item.no === no)
  const page = chapter?.page
  return typeof page === 'number' && page >= 1 ? Math.round(page) : 1
}

/** 给新导入的书一个不撞车的 id。 */
export function nextBookId(shelf: ShelfBook[]): string {
  let index = 1
  while (shelf.some((item) => item.id === `imported-${index}`)) index += 1
  return `imported-${index}`
}

/**
 * 扩展模式那张功能模块表的行轴：13 条功能，固定不变。
 *
 * 行轴固定、不跟着书走，是因为这张表想回答的问题不是「这本书有什么」，而是
 * 「这个作品覆盖了通信原理的哪些功能、这本书又对上了哪些」。书换成一本只认得出
 * 两章的外文书，行数还是 13 行，变的只是状态列——覆盖的少了，一眼就能看出来。
 *
 * `no` 就是课程视图那一章的章号：点一行就去那一章，取了书也照样能点。
 */
export type ModuleFunction = {
  /** 对应课程视图的章号（1–13）。 */
  no: number
  /** 功能名，一行一条。 */
  name: string
}

export const MODULE_FUNCTIONS: ModuleFunction[] = [
  { no: 1, name: '信息量与熵' },
  { no: 2, name: '确知信号的能量谱与功率谱' },
  { no: 3, name: '各态历经与统计平均' },
  { no: 4, name: '信道容量与香农公式' },
  { no: 5, name: '模拟调制的噪声性能' },
  { no: 6, name: '眼图与码间串扰' },
  { no: 7, name: '2ASK·2FSK·2PSK 的误码率' },
  { no: 8, name: 'QAM 与 OFDM 的谱效率' },
  { no: 9, name: '最佳接收与匹配滤波' },
  { no: 10, name: '抽样、量化与 PCM' },
  { no: 11, name: '汉明码的纠错能力' },
  { no: 12, name: 'm 序列与正交编码' },
  { no: 13, name: '锁相环的锁定' },
]

/** 本书没有识别到这一条功能时，状态格里给的那句话。 */
export const MISSING_FUNCTION = '本书未涉及'

/** 未涉及的那一行还能点，鼠标停上去说清楚点进去看到的是什么。 */
export const MISSING_FUNCTION_HINT = '本书未识别到这一章，仍可进入默认示例'

/** 这一行是靠什么认下来的：正文、标题兜底，还是根本没认出来。 */
export type CoverageBasis = 'body' | 'title' | 'none'

/** 功能模块表的一行：一条功能 + 本书里承担它的那一章（没有就是 null）。 */
export type CoverageRow = {
  /** 功能对应的课程视图章号。 */
  no: number
  /** 功能名。 */
  name: string
  /** 本书里接住这条功能的章；没接住就是 null。 */
  chapter: ShelfChapter | null
  /** 凭什么是它：正文命中 / 仅标题兜底 / 本书未涉及。 */
  basis: CoverageBasis
  /** 正文命中时留底，界面拿它写「『香农』12 次」。 */
  body: BodyScore | null
  /** 依据全文（含来源与页码），进单元格的 title，也印在状态下面一行。 */
  title: string
}

/** 13 条功能里本书覆盖了几条、剩下几条，以及书里还有几章认不出来。 */
export type Coverage = {
  /** 覆盖的功能条数（正文命中 + 仅标题兜底）。 */
  covered: number
  /** 其中真正读过正文、正文命中接住的条数。 */
  fromBody: number
  /** 其中只靠章名接住、正文没认到的条数。 */
  fromTitle: number
  /** 未涉及的功能条数。 */
  missing: number
  /** 本书里认不出模型的章数（这些章不占功能行，但要在表底交代一句）。 */
  unknown: number
  rows: CoverageRow[]
}

/** 正文依据：命中词 + 来源 + 页码，一句能印在界面上、也能查证的话。 */
export function bodyEvidence(chapter: ShelfChapter, body: BodyScore): string {
  const from = chapter.body
  const source = from?.source === 'ocr' ? 'OCR 文字' : '文字层'
  const pages = from?.pages ?? ''
  const tail = pages ? `（${source}，${pages}）` : `（${source}）`
  const words = bodyHitsLine(body.hits)
  if (!words) return `正文命中本功能${tail}`
  return `正文命中${words}${tail}`
}

/**
 * 把一本书的章摊到 13 条固定功能上。
 *
 * R126 起判定顺序换成「先读正文、再看章名」：正文的 Top1 分数过 `MIN_SCORE`、
 * 且领先第二名过 `MIN_MARGIN` 才算数（常数复用 `src/answer/locate.ts`，本轮没调）；
 * 正文不够才退回章名/节名，并且明写「仅按标题，未读正文」——兜底可以，但不许装成读过。
 * 反例守卫：与通信无关的书没有一章正文的词频能过这两条线，覆盖数就是 0。
 */
/** 正文打分的主题标识是 `ch04` 这种写法，功能清单里只有 04 这个数。 */
function topicNo(topicId: string | number): number {
  if (typeof topicId === 'number') return topicId
  const digits = topicId.replace(/\D/g, '')
  return digits ? Number(digits) : -1
}

export function coverageOf(book: ShelfBook): Coverage {
  const read = book.chapters
    .map((chapter) => ({ chapter, body: chapter.body ? scoreBody(chapter.body.text) : null }))
    .filter((item) => item.body !== null)

  const rows: CoverageRow[] = MODULE_FUNCTIONS.map((item) => {
    const hit =
      read.find(
        (entry) =>
          entry.body !== null &&
          topicNo(entry.body.topicId) === item.no &&
          entry.body.score >= MIN_SCORE &&
          entry.body.margin >= MIN_MARGIN,
      ) ?? null
    // 扫描版没有整页文字层可用，只有章首页那一段 OCR；单靠词频容易让「绪论」抢走
    // 每一章（信道/带宽/噪声这些词每章都提）。所以扫描版另走一条：章号已经由
    // 「第 N 页 · N.1」这类标题锁定，正文只要够 MIN_SCORE 分就认，不再要求领先。
    const hinted =
      read.find(
        (entry) =>
          entry.chapter.body?.source === 'ocr' &&
          entry.chapter.topicId === String(item.no) &&
          scoreTopic(entry.chapter.body.text, `ch${String(item.no).padStart(2, '0')}`).score >=
            MIN_SCORE,
      ) ?? null
    if (!hit && hinted && hinted.chapter.body) {
      const scored = scoreTopic(hinted.chapter.body.text, `ch${String(item.no).padStart(2, '0')}`)
      const body: BodyScore = {
        topicId: `ch${String(item.no).padStart(2, '0')}`,
        score: scored.score,
        runnerUp: 0,
        margin: scored.score,
        hits: scored.hits.slice(0, 5).map((term) => ({
          term,
          count: scored.hits.filter((each) => each === term).length,
        })),
      }
      return {
        no: item.no,
        name: item.name,
        chapter: hinted.chapter,
        basis: 'body',
        body,
        title: bodyEvidence(hinted.chapter, body),
      }
    }
    if (hit && hit.body) {
      return {
        no: item.no,
        name: item.name,
        chapter: hit.chapter,
        basis: 'body',
        body: hit.body,
        title: bodyEvidence(hit.chapter, hit.body),
      }
    }
    // 兜底也要有凭据：只有「章名/节名里真出现了这一章的概念词」才算按标题认下。
    // 早先只看 topicId（= 章号），任何一本 13 章的书都会被认成全覆盖——与通信无关的
    // 预算教材也能刷出 13/13，正是这轮要堵的反例。
    const trusted = book.id === DEFAULT_BOOK_ID
    const chapter =
      book.chapters.find(
        (entry) =>
          entry.topicId === String(item.no) &&
          isPlayable(entry) &&
          (trusted || (entry.hits?.length ?? 0) > 0 || (entry.sectionHits?.length ?? 0) > 0),
      ) ?? null
    if (chapter) {
      const readThis = chapter.body !== undefined
      const lead = readThis ? '正文没认到本功能，按标题兜底：' : '仅按标题，未读正文：'
      return {
        no: item.no,
        name: item.name,
        chapter,
        basis: 'title',
        body: null,
        title: `${lead}${evidenceOf(chapter)}`,
      }
    }
    return {
      no: item.no,
      name: item.name,
      chapter: null,
      basis: 'none',
      body: null,
      title: MISSING_FUNCTION_HINT,
    }
  })
  const fromBody = rows.filter((row) => row.basis === 'body').length
  const fromTitle = rows.filter((row) => row.basis === 'title').length
  return {
    covered: fromBody + fromTitle,
    fromBody,
    fromTitle,
    missing: rows.length - fromBody - fromTitle,
    unknown: book.chapters.filter((chapter) => !isPlayable(chapter)).length,
    rows,
  }
}

/**
 * 稳定书号：文件名 + 字节数 + 前 4 KB 的 SHA-256 前 8 字节。
 * 同一个文件不管导入几次都落到同一个 id，OCR 缓存与正文结果才能命中。
 */
export async function stableBookId(fileName: string, bytes: Uint8Array): Promise<string> {
  const head = bytes.subarray(0, 4096)
  const prefix = new TextEncoder().encode(`${fileName}\u0000${bytes.byteLength}\u0000`)
  const merged = new Uint8Array(prefix.length + head.length)
  merged.set(prefix, 0)
  merged.set(head, prefix.length)
  const digest = await crypto.subtle.digest('SHA-256', merged)
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
