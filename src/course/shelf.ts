/**
 * 书架：课程视图这一屏背后「现在用的是哪本书」。
 *
 * 一本书 = 标题 + 一列章。每章记四样：目录上的章号、原字标题、认到的主题、
 * 认出来时凭的哪几个词。这四样足够把「为什么这章能玩、那章不能玩」摊开讲清楚，
 * 也多一个字都不留。R93 起目录会存进浏览器的 IndexedDB（见 shelfDb.ts），
 * 这里仍然只是数据与纯函数：不碰 DOM、不碰 `localStorage`、不读文件。
 */

import { chapterByNo } from '../core/course.ts'
import type { OutlinedBook, OutlineEntry } from './pdfOutline.ts'
import { assignTopics, groupSections } from './sections.ts'
import { BOOK_COMMUNICATION } from './syllabus.ts'

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

/** 功能模块表的一行：一条功能 + 本书里承担它的那一章（没有就是 null）。 */
export type CoverageRow = {
  /** 功能对应的课程视图章号。 */
  no: number
  /** 功能名。 */
  name: string
  /** 本书里接住这条功能的章；没接住就是 null。 */
  chapter: ShelfChapter | null
  /** 命中词或未涉及提示，直接进单元格的 title。 */
  title: string
}

/** 13 条功能里本书覆盖了几条、剩下几条，以及书里还有几章认不出来。 */
export type Coverage = {
  /** 覆盖的功能条数。 */
  covered: number
  /** 未涉及的功能条数。 */
  missing: number
  /** 本书里认不出模型的章数（这些章不占功能行，但要在表底交代一句）。 */
  unknown: number
  rows: CoverageRow[]
}

/**
 * 把一本书的章摊到 13 条固定功能上。
 *
 * 一章只接一条功能：`topicId` 就是课程视图的章号，所以「哪一章覆盖哪条功能」
 * 是同一张表的两面，不另造一套映射。认不出模型的章（`topicId` 为空或对不上）
 * 不算覆盖，但要在 `unknown` 里数出来——表底那句「本书另有 K 章未识别」就是它。
 */
export function coverageOf(book: ShelfBook): Coverage {
  const rows: CoverageRow[] = MODULE_FUNCTIONS.map((item) => {
    const chapter = book.chapters.find((entry) => entry.topicId === String(item.no) && isPlayable(entry))
    return {
      no: item.no,
      name: item.name,
      chapter: chapter ?? null,
      title: chapter ? evidenceOf(chapter) : MISSING_FUNCTION_HINT,
    }
  })
  const covered = rows.filter((row) => row.chapter !== null).length
  return {
    covered,
    missing: rows.length - covered,
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
