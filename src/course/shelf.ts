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
  return {
    id,
    title,
    chapters: assignTopics(groupSections(entries)).map((chapter) => ({
      no: chapter.no,
      rawTitle: chapter.rawTitle,
      topicId: chapter.topicId,
      hits: chapter.hits,
      sectionHits: chapter.sectionHits,
    })),
  }
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

/** 给新导入的书一个不撞车的 id。 */
export function nextBookId(shelf: ShelfBook[]): string {
  let index = 1
  while (shelf.some((item) => item.id === `imported-${index}`)) index += 1
  return `imported-${index}`
}
