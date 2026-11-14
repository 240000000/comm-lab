/**
 * 逐章正文：每章首页 OCR 一次，再用概念词判它最像课程视图里的哪一章。
 *
 * 只读每章的第一页，不做整章 OCR：判定靠关键词密度，一页足够，
 * 13 页也压得住 90 秒的超时。识别结果写进 ocr store，重进不重跑。
 */
import { TOPICS, countTerms } from './concepts.ts'
import { createOcrWorker, recognizePages, type OcrWorker } from './ocr.ts'
import { loadFromPdfjs, type PdfDocument } from './pdfSource.ts'
import type { ShelfChapter } from './shelf.ts'

export type ChapterScan = {
  chapterNo: number
  page: number
  chars: number
  ms: number
  topicNo: number | null
  name: string
  hits: string[]
  score: number
}

export type ChapterScanProgress = { done: number; total: number; chapterNo: number }

export type ChapterScanOutcome =
  | { ok: true; scans: ChapterScan[] }
  | { ok: false; message: string }

/** 一章最多看一页；13 章正好覆盖课程视图的全部。 */
const MAX_HEAD_PAGES = 13
const MAX_HITS = 3

function topicName(topicId: string): string {
  return TOPICS.find((topic) => topic.topicId === topicId)?.title ?? '未命中'
}

const termKey = (term: string): string => term.toLowerCase().replace(/\s+/g, '')

/** 章标题里的词：书上首页一定会印章名，命中它比正文里出现十次都准。 */
const TITLE_KEYS = new Map<string, string[]>()
function titleKeys(topicId: string, title: string): string[] {
  const cached = TITLE_KEYS.get(topicId)
  if (cached) return cached
  const keys = title
    .split(/[：:/、（）()\s]+/)
    .map((part) => termKey(part))
    .filter((part) => part.length >= 2)
  TITLE_KEYS.set(topicId, keys)
  return keys
}

/**
 * 从正文里找节号（5.1 / 13.2），取出现次数最多的章号。
 *
 * 书上每章首页都印着「N.1 概述」这类节号，比词频可靠得多：页 16 的正文几乎全是
 * 绪论才会出现的说法，但只靠词频会被「信道」「噪声」带偏；而页 101 里
 * 「7.8」「5.1」各出现一次时，取出现更多次的（这一页余下都是 5.x）。
 * 「第 N 章」不算——那是正文里引用别的章（页 78 讲信道，却写着「第 1 章提到过信道」）。
 */
function detectChapterHint(text: string): number | null {
  const flat = text.replace(/\s+/g, '')
  const pick = (pattern: RegExp): number | null => {
    const counts = new Map<number, number>()
    for (const match of flat.matchAll(pattern)) {
      const no = Number(match[1])
      if (no < 1 || no > TOPICS.length) continue
      counts.set(no, (counts.get(no) ?? 0) + 1)
    }
    let best: number | null = null
    let bestCount = 0
    for (const [no, count] of counts) {
      // 平票取小：图号（7.8）偶尔比真正的节号先出现，小号更可能是章的起始节。
      if (count > bestCount || (count === bestCount && best !== null && no < best)) {
        best = no
        bestCount = count
      }
    }
    return best
  }
  // 每章首页印的是「N.1 概述」，这一条最干净；整页没有 N.1 时才退回任意 N.M。
  return pick(/(\d{1,2})[.．]1(?!\d)/g) ?? pick(/(\d{1,2})[.．]\d/g)
}

/**
 * 一页正文按「页内稀有度」判章：同一个词在越多页出现，权重越低。
 *
 * 13 章首页里几乎每页都有「信道」「噪声」，按次数累加会把绪论顶到每一章头上；
 * 只在一两页出现的词（正交、伪随机、确知信号）才该决定归属。
 */
function scanWithWeights(
  chapterNo: number,
  page: number,
  text: string,
  ms: number,
  weight: (term: string) => number,
  hint: number | null = null,
): ChapterScan {
  const counts = countTerms(text)
  const hintTopic = hint === null ? null : TOPICS.find((topic) => topic.topicId === `ch${String(hint).padStart(2, '0')}`)
  if (hintTopic) {
    // 节号 N.1 印在章首页上，这就是第 N 章，不必再让词频去猜；
    // 词频只负责挑出这一节最像的命中词，供界面显示。
    const scored = hintTopic.terms
      .map((term) => ({ term, count: counts.get(termKey(term)) ?? 0 }))
      .filter((item) => item.count > 0)
      .map((item) => ({ term: item.term, value: item.count * weight(item.term) }))
      .sort((a, b) => b.value - a.value)
    const hits = scored.map((item) => item.term)
    return {
      chapterNo,
      page,
      chars: text.replace(/\s+/g, '').length,
      ms,
      topicNo: Number(hintTopic.topicId.replace(/^ch/i, '')),
      name: hintTopic.title,
      hits: hits.slice(0, MAX_HITS),
      score: Math.round((scored.reduce((sum, item) => sum + item.value, 0) / Math.sqrt(hintTopic.terms.length)) * 100) / 100,
    }
  }
  let bestTopic: { topicId: string; score: number; hits: string[] } | null = null
  for (const topic of TOPICS) {
    const title = titleKeys(topic.topicId, topic.title)
    const scored = topic.terms
      .map((term) => ({ term, count: counts.get(termKey(term)) ?? 0 }))
      .filter((item) => item.count > 0)
      .map((item) => {
        const key = termKey(item.term)
        const boost = title.some((part) => part.includes(key) || key.includes(part)) ? 2.5 : 1
        return { term: item.term, value: item.count * weight(item.term) * boost }
      })
      .sort((a, b) => b.value - a.value)
    if (scored.length === 0) continue
    // 词表越长的章天然能累加更多分，按 √词数 归一，避免「绪论」那种大词表通吃。
    const raw = scored.reduce((sum, item) => sum + item.value, 0) / Math.sqrt(topic.terms.length)
    const score = Math.round(raw * 100) / 100
    if (bestTopic && score <= bestTopic.score) continue
    bestTopic = { topicId: topic.topicId, score, hits: scored.map((item) => item.term) }
  }
  return {
    chapterNo,
    page,
    chars: text.replace(/\s+/g, '').length,
    ms,
    topicNo: bestTopic ? Number(bestTopic.topicId.replace(/^ch/i, '')) : null,
    name: bestTopic ? topicName(bestTopic.topicId) : '未命中',
    hits: bestTopic ? bestTopic.hits.slice(0, MAX_HITS) : [],
    score: bestTopic?.score ?? 0,
  }
}

/** 一段正文 → 一条扫描结果（页码、字数、耗时、最像的章与命中词）。 */
export function scanFromText(chapterNo: number, page: number, text: string, ms = 0): ChapterScan {
  return scanWithWeights(chapterNo, page, text, ms, () => 1) satisfies ChapterScan
}

/** 纯函数：已有正文时只做打分，不碰 OCR。 */
export function scoreChapterTexts(chapters: ShelfChapter[], texts: Map<number, string>): ChapterScan[] {
  const entries = chapters
    .map((chapter, index) => ({ chapter, no: chapter.no ?? index + 1 }))
    .map((entry) => ({ ...entry, text: texts.get(entry.no) ?? '' }))
    .filter((entry) => entry.text.replace(/\s+/g, '').length > 0)
  if (entries.length === 0) return []
  const countsByPage = entries.map((entry) => countTerms(entry.text))
  const docFreq = new Map<string, number>()
  for (const counts of countsByPage) {
    for (const key of counts.keys()) docFreq.set(key, (docFreq.get(key) ?? 0) + 1)
  }
  const total = entries.length
  const weight = (term: string): number => {
    const freq = docFreq.get(termKey(term)) ?? total
    return Math.log(1 + total / Math.max(freq, 1))
  }
  return entries.map((entry) =>
    scanWithWeights(entry.no, entry.chapter.page ?? 0, entry.text, 0, weight, detectChapterHint(entry.text)),
  )
}

/**
 * 对每个有页码的章 OCR 它的首页，最多 13 页。
 * 失败返回 `{ ok:false, message }`，调用方保留标题级匹配即可。
 */
export async function recognizeChapterHeads(
  bookId: string,
  blob: Blob | null,
  chapters: ShelfChapter[],
  onProgress?: (progress: ChapterScanProgress) => void,
  options: { signal?: AbortSignal; worker?: OcrWorker; doc?: PdfDocument } = {},
): Promise<ChapterScanOutcome> {
  const candidates = chapters
    .filter((chapter) => typeof chapter.page === 'number' && chapter.page >= 1)
    .slice(0, MAX_HEAD_PAGES)
  if (candidates.length === 0) return { ok: false, message: '这本书没有可读的章首页页码' }

  let worker: OcrWorker | null = options.worker ?? null
  const ownWorker = !worker
  let doc: PdfDocument | null = null
  try {
    if (!worker) worker = await createOcrWorker()
    // 153 MB 的扫描书每章重读一遍 blob、重解析一遍文档，进度条会卡在 0/13；
    // 这里整本只打开一次，13 页共用同一份 doc。调用方已经开着这本书时
    // （课程视图右侧的 PDF 预览）直接借它的 doc，免得同一页上开两份 153 MB。
    doc = options.doc ?? (await loadFromPdfjs(new Uint8Array(await (blob as Blob).arrayBuffer())))
    const scans: ChapterScan[] = []
    const texts = new Map<number, string>()
    for (let index = 0; index < candidates.length; index += 1) {
      const chapter = candidates[index]
      const no = chapter.no ?? index + 1
      const page = chapter.page as number
      onProgress?.({ done: index, total: candidates.length, chapterNo: no })
      const started = performance.now()
      const outcome = await recognizePages(null, [page], undefined, {
        bookId,
        signal: options.signal,
        worker,
        doc,
      })
      if (!outcome.ok) return { ok: false, message: outcome.message }
      const text = outcome.pages[0]?.text ?? ''
      const ms = Math.round(performance.now() - started)
      scans.push(scanFromText(no, page, text, ms))
      texts.set(no, text)
    }
    // 逐页扫完再统一定章：稀有度权重要知道「某个词出现在几页上」，单页扫的时候
    // 拿不到这份全局信息，绪论那种大词表就会把每一章都吃掉。
    const rescored = new Map(scoreChapterTexts(candidates, texts).map((scan) => [scan.chapterNo, scan]))
    return {
      ok: true,
      scans: scans.map((scan) => {
        const better = rescored.get(scan.chapterNo)
        return better ? { ...better, chars: scan.chars, ms: scan.ms } : scan
      }),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '正文识别失败' }
  } finally {
    // 借来的 doc 归调用方（PDF 预览）管，这里不能销毁。
    if (doc && !options.doc) await doc.destroy().catch(() => {})
    if (ownWorker && worker) await worker.terminate()
  }
}
