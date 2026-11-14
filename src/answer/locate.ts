import { scoreSection, type TopicScore } from '../course/concepts.ts'

/** 定位结果：Top1 章节号 + 命中词 + 是否「不够明显」。 */
export type LocateOutcome = {
  chapter: number
  hits: string[]
  score: number
  /** 前三名，判据模糊时让用户自己挑 */
  top: TopicScore[]
  ambiguous: boolean
}

/** topicId 形如 'ch07'，转成章节号 7；解析不了就返回 0。 */
export function chapterFromTopic(topicId: string): number {
  const digits = topicId.replace(/[^0-9]/g, '')
  const no = Number.parseInt(digits, 10)
  return Number.isFinite(no) ? no : 0
}

/**
 * 分数太低、或第一名与第二名咬得太紧，都算「不够明显」：
 * 这类输入不硬猜章节，交给左栏的 Top3 让用户自己选。
 */
const MIN_SCORE = 3
const MIN_MARGIN = 2

/** 用 concepts 的 scoreSection 给题面定位章节。 */
export function locateProblem(text: string): LocateOutcome | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const ranked = scoreSection(trimmed)
  const first = ranked[0]
  if (!first) return null
  const second = ranked[1]
  const margin = second ? first.score - second.score : first.score
  const ambiguous = first.score < MIN_SCORE || margin < MIN_MARGIN
  return {
    chapter: chapterFromTopic(first.topicId),
    hits: first.hits.slice(0, 6),
    score: first.score,
    top: ranked,
    ambiguous,
  }
}