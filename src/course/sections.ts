/**
 * 节名聚合：一章的名字认不出主题时，看它下面的节名。
 *
 * 规则写死，不留手感参数：
 * - 同一主题在一章里被至少 SECTION_MIN_HITS 条节名认到，这一章就归这个主题；
 * - 否则退回章名匹配（matchChapter(rawTitle)），跟 R89 之前一样；
 * - 章名也认不到，判未覆盖（topicId = null）。
 * - 两章抢同一主题：命中条数多者得；条数相同按章号小者得；都没章号时按目录里先出现的得。
 * - 章名回退不跟节级认领抢：已经被节名认走的主题，章名回退不再认，免得把有证据的章挤掉。
 *
 * 纯函数：只吃目录条目，不碰 pdf.js、不碰 DOM，所以能单测。
 */
import { matchChapter } from './match.ts'

/** 一章里同一主题要出现几次才算数。写死是为了让「凭手感调阈值」这件事不可能发生。 */
export const SECTION_MIN_HITS = 2

/** 目录里的一条，只要聚类用得上的三个字段。 */
export type SectionRow = {
  rawTitle: string
  depth?: 0 | 1 | 2
  chapterNo?: number | null
}

/** 聚好的一章：章级条目 + 它下面所有节/小节的原字标题。 */
export type SectionChapter = {
  no: number | null
  rawTitle: string
  sections: string[]
}

/** 一章的归属结论。 */
export type ChapterMatch = {
  no: number | null
  rawTitle: string
  topicId: string | null
  /** 触发归属的节名原文，最多三条。 */
  sectionHits: string[]
  /** 章名匹配命中的词，最多三条；只有章名回退时才非空。 */
  hits: string[]
  /** 'section' 节名认的、'chapter' 章名认的、'none' 都没认到。 */
  by: 'section' | 'chapter' | 'none'
  /** 认下这个主题靠了几条节名；章名回退时是 0。 */
  count: number
}

/** 章号为空的排最后：有章号的按号比，没章号的让位。 */
function orderKey(no: number | null): number {
  return no === null ? Number.MAX_SAFE_INTEGER : no
}

/** 把三级条目按章聚起来：只收挂在这一章下面的节，落在章外的不塞给任何章。 */
export function groupSections(entries: SectionRow[]): SectionChapter[] {
  const chapters: SectionChapter[] = []
  let current: SectionChapter | null = null
  for (const entry of entries) {
    const depth = entry.depth ?? 0
    const chapterNo = entry.chapterNo ?? null
    if (depth === 0) {
      current = { no: chapterNo, rawTitle: entry.rawTitle, sections: [] }
      chapters.push(current)
      continue
    }
    if (current !== null && chapterNo === current.no) current.sections.push(entry.rawTitle)
  }
  return chapters
}

/** 一章的节名各自投票，取票数过线且最多的那个主题；没有过线的返回 null。 */
export function matchBySections(sections: string[]): { topicId: string; hits: string[]; count: number } | null {
  const tally = new Map<string, string[]>()
  const seen: string[] = []
  for (const title of sections) {
    const matched = matchChapter(title)
    if (!matched) continue
    const bucket = tally.get(matched.topicId)
    if (bucket) {
      bucket.push(title)
    } else {
      tally.set(matched.topicId, [title])
      seen.push(matched.topicId)
    }
  }
  let best: { topicId: string; hits: string[]; count: number } | null = null
  for (const topicId of seen) {
    const titles = tally.get(topicId) ?? []
    const count = titles.length
    if (count < SECTION_MIN_HITS) continue
    const better =
      best === null ||
      count > best.count ||
      // 平手按主题号小者，纯确定性，不掺任何权重。
      (count === best.count && Number(topicId) < Number(best.topicId))
    if (better) best = { topicId, hits: titles.slice(0, 3), count }
  }
  return best
}

/**
 * 整本书的归属：先让节级认领按（票数降序、章号升序）依次拿走主题，再让章名回退捡剩下的。
 * 这样「两章抢同一主题」的裁决只有一个地方，测试也只钉这一处。
 */
export function assignTopics(chapters: SectionChapter[]): ChapterMatch[] {
  const rows = chapters.map((chapter) => ({
    no: chapter.no,
    rawTitle: chapter.rawTitle,
    topicId: null as string | null,
    sectionHits: [] as string[],
    hits: [] as string[],
    by: 'none' as ChapterMatch['by'],
    count: 0,
    section: matchBySections(chapter.sections),
  }))

  const claims = rows
    .filter((row) => row.section !== null)
    .sort((a, b) => {
      const diff = (b.section?.count ?? 0) - (a.section?.count ?? 0)
      if (diff !== 0) return diff
      return orderKey(a.no) - orderKey(b.no)
    })

  const taken = new Set<string>()
  for (const row of claims) {
    const section = row.section
    if (!section || taken.has(section.topicId)) continue
    taken.add(section.topicId)
    row.topicId = section.topicId
    row.sectionHits = section.hits
    row.by = 'section'
    row.count = section.count
  }

  for (const row of rows) {
    if (row.by === 'section') continue
    const matched = matchChapter(row.rawTitle)
    if (!matched || taken.has(matched.topicId)) continue
    taken.add(matched.topicId)
    row.topicId = matched.topicId
    row.hits = matched.hits
    row.by = 'chapter'
  }

  return rows.map(({ section: _section, ...rest }) => rest)
}
