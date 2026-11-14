/**
 * 课程视图。
 *
 * 左边是教材的 13 章目录，右边只渲染当前这一章的一屏：
 * 一句话问题、两三个滑块、一张图、三个读数、一句话结论。
 * 每章的计算都在 src/core/course.ts 里，页面只负责把参数递进去、把结果摆出来。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDragCoalescer } from './dragCommit'
import {
  COURSE_CHAPTERS,
  DEEP_LAB_CHAPTERS,
  chapterByNo,
  type CourseChapter,
  type CourseParam,
  type CourseView,
} from '../core/course.ts'
import { chartLabel } from './chartLabel.ts'
import { CourseChart } from './CourseChart.tsx'
import { CourseLegend } from './CourseLegend.tsx'
import { ParamSlider } from './ParamSlider.tsx'
import { PdfPane, type PdfScale } from './PdfPane.tsx'
import { getBookPdf, loadDoc } from '../course/pdfSource.ts'
import type { ChapterScan } from '../course/chapterOcr.ts'
import type { OutlineEntry } from '../course/pdfOutline.ts'
import {
  DEFAULT_BOOK_ID,
  UNCOVERED_NOTE,
  billOf,
  bookById,
  bookFromSections,
  chapterPage,
  defaultShelfBook,
  evidenceOf,
  isPlayable,
  stableBookId,
} from '../course/shelf.ts'
import type { ShelfBook } from '../course/shelf.ts'
import { getShelf, importBook, markPdfSaved, noteStorage, removeBookById, setActive, useShelf } from '../course/shelfStore.ts'
import { saveOriginalPdf } from './bookStorage.ts'

const START_CHAPTER = 2

/** 打开原件的上限：484 页的扫描书解析要几十秒，但超过三分钟就是卡死了。 */
const DOC_OPEN_TIMEOUT_MS = 180_000

/** 给任意 promise 套一个上限，超时就抛错——不然界面永远停在「0/13」。 */
function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    task.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 扫描件导入的三段状态：识别中、等确认、失败退回手动。 */
type OcrState =
  | { phase: 'reading'; page: number; total: number }
  | { phase: 'confirm'; fileName: string; bookId: string; entries: OutlineEntry[]; offset: number }
  | { phase: 'failed'; fileName: string; bookId: string; message: string }

/** 地址里带 ?no=5 时直接打开第 5 章，截图与分享都用得上。 */
function initialChapter(): number {
  const query = window.location.hash.split('?')[1] ?? ''
  const no = Number(new URLSearchParams(query).get('no'))
  return chapterByNo(no) ? no : START_CHAPTER
}

/** 目录一行：默认教材与导入教材共用这一种画法。 */
type TreeRow = {
  key: string
  mark: string
  done: boolean
  no: string
  title: string
  note: string | null
  active: boolean
  disabled: boolean
  onPick: () => void
}

/** 目录与拖动无关，单独拿出来 memo，切参数时不跟着重渲染。 */
const CourseTree = memo(function CourseTree({ rows }: { rows: TreeRow[] }) {
  return (
    <nav className="course-tree" aria-label="课程目录">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          className={`course-item${row.active ? ' active' : ''}${row.disabled ? ' disabled' : ''}`}
          onClick={row.onPick}
          disabled={row.disabled}
        >
          <span className={`course-mark${row.done ? ' done' : ''}`}>{row.mark}</span>
          <span className="course-no">{row.no}</span>
          <span className="course-title">
            {row.title}
            {row.note ? <em className="course-note">{row.note}</em> : null}
          </span>
        </button>
      ))}
    </nav>
  )
})

const Control = memo(function Control({
  paramKey,
  param,
  value,
  params,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  paramKey: string
  param: CourseParam
  value: number
  params: Record<string, number>
  onChange: (key: string, value: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const handleChange = useCallback((next: number) => onChange(paramKey, next), [onChange, paramKey])
  // 上限可以跟着别的参数走（第 12 章的 τ 跟着 N）；不写 maxFor 的章还是用 param.max。
  const max = param.maxFor ? param.maxFor(params) : param.max

  if (param.options) {
    return (
      <label className="control">
        <span className="control-label">
          {param.label}
          <b>{param.options[value]}</b>
        </span>
        <select value={value} onChange={(event) => handleChange(Number(event.target.value))}>
          {param.options.map((option, index) => (
            <option key={option} value={index}>
              {option}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <ParamSlider
      label={param.label}
      value={value}
      min={param.min}
      max={max}
      step={param.step}
      unit={param.unit}
      onChange={handleChange}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    />
  )
})

/**
 * 深度实验台入口。数据只有一处——`src/core/course.ts` 每章的 labs，
 * 这里只负责画：已实现的章（结论卡下面）与未实现的章（TodoScreen）共用，
 * 免得 labs 只写在一边、另一边成了死代码。没有 labs 的章不占位。
 */
function CourseLabs({ labs }: { labs?: { label: string; href: string }[] }) {
  if (!labs?.length) return null
  return (
    <div className="course-labs">
      {labs.map((lab) => (
        <a className="course-btn" key={lab.href} href={lab.href}>
          去{/^[A-Za-z]/.test(lab.label) ? ' ' : ''}
          {lab.label}
        </a>
      ))}
    </div>
  )
}

const ChapterScreen = memo(function ChapterScreen({
  chapter,
  params,
  onChange,
  onDragStart,
  onDragEnd,
  onFail,
  onReset,
  view,
  evidence,
  onJump,
  onJumpPage,
}: {
  chapter: CourseChapter
  params: Record<string, number>
  onChange: (key: string, value: number) => void
  onDragStart: () => void
  onDragEnd: () => void
  onFail: () => void
  onReset: () => void
  view: CourseView
  evidence: ChapterScan | null
  onJump: (no: number) => void
  onJumpPage: (page: number) => void
}) {
  return (
    <>
      <p className="course-question">{chapter.question}</p>

      <div className="course-params">
        {chapter.params.map((param) => (
          <Control
            key={param.key}
            paramKey={param.key}
            param={param}
            value={params[param.key]}
            params={params}
            onChange={onChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>

      <div className="course-chart">
        <CourseLegend series={view.series} />
        <CourseChart
          label={chartLabel({
            no: chapter.no,
            title: chapter.title,
            question: chapter.question,
            readouts: view.readouts,
          })}
          series={view.series}
          xLabel={view.xLabel}
          yLabel={view.yLabel}
          logY={view.logY}
          logX={view.logX}
          bars={view.bars}
          stack={view.stack}
          guides={view.guides}
          xTicks={view.xTicks}
          yTicks={view.yTicks}
          markerX={view.markerX}
          markerLabel={view.markerLabel}
          xRange={view.xRange}
          yRange={view.yRange}
          highlightX={view.highlightX}
        />
      </div>

      <div className="readouts course-readouts">
        {view.readouts.map((readout) => (
          <article key={readout.label} className={`readout${readout.warn ? ' warn' : ''}`}>
            <div className="readout-head">
              <h2>{readout.label}</h2>
              <p className="readout-value">{readout.value}</p>
            </div>
            <p className="readout-note">{readout.hint}</p>
          </article>
        ))}
      </div>

      <section className={`course-conclusion${view.failed ? ' failed' : ''}`}>
        <p>{view.conclusion}</p>
        {evidence ? (
          <p className="course-evidence">
            书上这一节：第 {chapter.no} 章 · 第 {evidence.page} 页
            {evidence.hits.length > 0 ? ` · 命中 ${evidence.hits.join('、')}` : ' · 没抠到概念词'}
            {evidence.topicNo && evidence.topicNo !== chapter.no
              ? ` · 最像第 ${evidence.topicNo} 章 ${evidence.name}`
              : ''}
            <button type="button" className="course-btn ghost" onClick={() => onJumpPage(evidence.page)}>
              翻到第 {evidence.page} 页
            </button>
            {evidence.topicNo && evidence.topicNo !== chapter.no ? (
              <button type="button" className="course-btn ghost" onClick={() => onJump(evidence.topicNo as number)}>
                去看
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="course-actions">
          <button type="button" className="course-btn" onClick={onFail}>
            让它失效
          </button>
          <button type="button" className="course-btn ghost" onClick={onReset}>
            回到默认
          </button>
        </div>
        <CourseLabs labs={chapter.labs} />
      </section>
    </>
  )
})

const MAX_PDF_BYTES = 250 * 1024 * 1024
const SLOW_PARSE_MS = 15_000

/** 解析完先出账单；账单上点了「用这本书」才换左树。 */
type BillState = { fileName: string; book: ShelfBook }

type ImportState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string; slow: boolean }
  | { status: 'failed'; fileName: string; message: string }

export function CoursePage() {
  const [no, setNo] = useState(initialChapter)
  const chapter = chapterByNo(no) ?? chapterByNo(START_CHAPTER)!
  const [params, setParams] = useState<Record<string, number>>(chapter.defaults)
  const [committed, setCommitted] = useState<Record<string, number>>(chapter.defaults)
  const dragRef = useRef(createDragCoalescer<Record<string, number>>())
  const paramsRef = useRef(params)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })
  // 书架提到模块级（shelfStore）：首页和这里读同一份，落盘在本机 IndexedDB（刷新后还在）。
  const { books, activeId, pdfBytes } = useShelf()
  const [bill, setBill] = useState<BillState | null>(null)
  const [switching, setSwitching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const slowTimer = useRef<number | null>(null)

  const book = bookById(books, activeId)
  const usingDefault = book.id === DEFAULT_BOOK_ID
  const hasPdf = Boolean(pdfBytes[book.id])
  const [showBook, setShowBook] = useState(true)
  const [bookScale, setBookScale] = useState<PdfScale>('fit')
  const [scanState, setScanState] = useState<{
    key: string
    scans?: ChapterScan[]
    progress?: { done: number; total: number }
    note?: string
  } | null>(null)

  // 扫描版：有原件的书导入后自动读每章首页，给结论卡补一行「书上这一节」。
  // 「这本书扫过没有」放在 ref 里：把 scanState 当依赖会让 effect 自己触发自己，
  // 第一次 setScanState 就把 alive 置 false，后面的识别永远静默不跑（0/13 卡死）。
  const scanStarted = useRef<string | null>(null)
  useEffect(() => {
    if (usingDefault || !hasPdf) return
    if (scanStarted.current === book.id) return
    scanStarted.current = book.id
    let alive = true
    // 卡在哪一步要看得见：大扫描件慢起来是几分钟，光看 0/13 分不清是在解析
    // 原文件还是在等识别引擎。阶段写在 <html data-r108stage>，截图与脚本都能读。
    const stage = (name: string, detail = '') => {
      document.documentElement.dataset.r108stage = detail ? `${name}:${detail}` : name
    }
    void (async () => {
      const blob = await getBookPdf(book.id)
      if (!blob || !alive) return
      stage('blob', String(blob.size))
      setScanState({ key: book.id, progress: { done: 0, total: book.chapters.length } })
      // 右侧预览已经把这本书解析开了就借它的 doc：153 MB 的扫描件在同一页
      // 开两份，解析会卡到进度条永远停在 0/13 且不报错。
      stage('open')
      const loaded = await withTimeout(loadDoc(book.id), DOC_OPEN_TIMEOUT_MS, '打开原文件超时').catch(
        (error: unknown) => {
          stage('open-failed', error instanceof Error ? error.message : '打开失败')
          return null
        },
      )
      if (!alive) return
      if (!loaded || loaded.status !== 'ok') {
        setScanState({ key: book.id, note: '原件没能打开，正文识别跳过' })
        return
      }
      stage('ocr')
      const { recognizeChapterHeads } = await import('../course/chapterOcr.ts')
      const outcome = await recognizeChapterHeads(
        book.id,
        blob,
        book.chapters,
        (progress) => {
          if (alive) setScanState({ key: book.id, progress: { done: progress.done, total: progress.total } })
        },
        { doc: loaded.doc },
      )
      if (!alive) return
      if (outcome.ok) {
        console.info('[R108]', JSON.stringify(outcome.scans))
        document.documentElement.dataset.r108 = JSON.stringify(outcome.scans)
        setScanState({ key: book.id, scans: outcome.scans })
      } else {
        setScanState({ key: book.id, note: outcome.message })
      }
    })()
    return () => {
      alive = false
    }
  // 依赖里不能放 scanState：它一写入就会重跑 effect、把 alive 置 false，
    // 识别链在第一个 await 之后就静默退出了（曾经卡在 0/13 的原因）。
  }, [book, hasPdf, usingDefault])

  const chapterScanOf = useCallback(
    (chapterNo: number): ChapterScan | null => {
      const bookChapter = book.chapters.find((chapter) => chapter.topicId === String(chapterNo))
      if (!scanState || scanState.key !== book.id || !scanState.scans) return null
      return scanState.scans.find((scan) => scan.chapterNo === (bookChapter?.no ?? chapterNo)) ?? null
    },
    [book, scanState],
  )
  const pageKey = `${book.id}:${no}`
  const [pageChoice, setPageChoice] = useState<{ key: string; page: number } | null>(null)
  const [ocrState, setOcrState] = useState<OcrState | null>(null)
  const [ocrDraft, setOcrDraft] = useState('')
  const ocrAbort = useRef<AbortController | null>(null)
  const ocrFile = useRef<File | null>(null)
  const bookPage = pageChoice && pageChoice.key === pageKey ? pageChoice.page : chapterPage(book, no)
  const changeBookPage = (next: number) => {
    setPageChoice({ key: `${book.id}:${no}`, page: next })
  }
  const billStat = bill ? billOf(bill.book) : null

  const view = useMemo(
    () => (chapter.compute ? chapter.compute(committed) : null),
    [chapter, committed],
  )

  const pick = useCallback((next: number) => {
    const target = chapterByNo(next)
    if (!target) return
    setNo(next)
    setParams(target.defaults)
    paramsRef.current = target.defaults
    setCommitted(target.defaults)
  }, [])

  const setParam = useCallback((key: string, value: number) => {
    const next = { ...paramsRef.current, [key]: value }
    // 上限跟着别的参数走时（第 12 章的 τ 跟着 N），把越界的值收回来：拖完 τ 再降级数，不留框外的值。
    for (const item of chapter.params) {
      const max = item.maxFor ? item.maxFor(next) : item.max
      if (next[item.key] > max) next[item.key] = max
      if (next[item.key] < item.min) next[item.key] = item.min
    }
    paramsRef.current = next
    setParams(next)
    dragRef.current.push(next, setCommitted)
  }, [chapter])

  const onDragStart = useCallback(() => dragRef.current.begin(), [])
  const onDragEnd = useCallback(() => dragRef.current.end(setCommitted), [])

  const onFail = useCallback(() => {
    const preset = chapter.failPreset
    paramsRef.current = preset
    setParams(preset)
    setCommitted(preset)
  }, [chapter])

  const onReset = useCallback(() => {
    paramsRef.current = chapter.defaults
    setParams(chapter.defaults)
    setCommitted(chapter.defaults)
  }, [chapter])

  const stopSlowTimer = useCallback(() => {
    if (slowTimer.current !== null) {
      window.clearTimeout(slowTimer.current)
      slowTimer.current = null
    }
  }, [])

  /** 有原文件就按开关存；OCRed 的书也能存原件。 */
  const saveIfWanted = useCallback(async (file: File, bookId: string) => {
    if (!getShelf().keepPdf) {
      noteStorage('这次只存了目录（「导入时同时保存原文件」关着）')
      return
    }
    const saved = await saveOriginalPdf(file, bookId)
    if (saved.status === 'saved') markPdfSaved(bookId, saved.bytes)
    else noteStorage(saved.message)
  }, [])

  /** 扫描件：读前 12 页找目录页，OCR 一页，抠出章名后等用户确认。 */
  const tryOcrOutline = useCallback(async (file: File, fileName: string, bookId: string) => {
    ocrFile.current = file
    setOcrState({ phase: 'reading', page: 0, total: 1 })
    try {
      const ocr = await import('../course/ocr.ts')
      const outlineOcr = await import('../course/outlineOcr.ts')
      const { loadFromPdfjs } = await import('../course/pdfSource.ts')
      const { extractDocText } = await import('../course/pdfText.ts')
      const doc = await loadFromPdfjs(new Uint8Array(await file.arrayBuffer()))
      let pages: string[] = []
      let pageCount = 0
      try {
        pageCount = doc.numPages
        pages = (await extractDocText(doc)).pages
      } finally {
        await doc.destroy()
      }
      // 有文字层就直接挑目录页；扫描件没有文字，只能逐页 OCR 再挑。
      let tocPages: string[] = []
      const textToc = outlineOcr.findTocPage(pages)
      if (textToc > 0) {
        tocPages = pages.slice(textToc - 1, textToc + 8)
      } else {
        const controller = new AbortController()
        ocrAbort.current = controller
        const limit = Math.min(20, pageCount)
        const scanned: string[] = []
        const collect = async (from: number, to: number): Promise<string[]> => {
          if (to <= from) return []
          const outcome = await ocr.recognizePages(
            file,
            Array.from({ length: to - from }, (_, index) => from + index + 1),
            (progress) =>
              setOcrState({ phase: 'reading', page: progress.page, total: progress.total }),
            { bookId, signal: controller.signal },
          )
          if (!outcome.ok) throw new Error(outcome.message)
          return outcome.pages.map((item) => item.text)
        }
        // 真书的目录紧挨着前言，扫前 4 页就能认出来；认不出才往后翻到第 20 页。
        scanned.push(...(await collect(0, Math.min(4, limit))))
        let tocIndex = outlineOcr.findTocPage(scanned)
        if (tocIndex < 0 && limit > 4) {
          scanned.push(...(await collect(4, limit)))
          tocIndex = outlineOcr.findTocPage(scanned)
        }
        ocrAbort.current = null
        if (tocIndex < 0) throw new Error('前 20 页里没找到目录页')
        // 目录常常跨四五页，只取「目录」那页会漏掉后半本的章；按编号密度把所有目录页捡回来。
        const dense = outlineOcr.tocDensePages(scanned)
        tocPages =
          dense.length > 0
            ? dense.map((index) => scanned[index])
            : scanned.slice(tocIndex - 1, tocIndex + 8)
      }
      // 扫描件的「第 N 章」常被认成「第 针 章」，改按目录里的「N.1」定章；
      // 有文字层的书照旧走章名那一套。
      let entries = outlineOcr.parseTocChapters(tocPages)
      if (entries.length === 0) {
        entries = outlineOcr
          .parseTocEntries(tocPages.join('\n'))
          .filter((entry) => entry.depth === 0)
      }
      if (entries.length === 0) throw new Error('目录页的文字认出来了，但没抠出章名')
      setOcrState({ phase: 'confirm', fileName, bookId, entries, offset: 0 })
    } catch (error) {
      setOcrState({
        phase: 'failed',
        fileName,
        bookId,
        message: error instanceof Error ? error.message : '识别失败，可以手动输目录',
      })
    } finally {
      ocrAbort.current = null
    }
  }, [setOcrState])

  /** 确认表 → 建书；页码按偏移换算成 PDF 页号。 */
  const confirmOcrBook = useCallback(async () => {
    if (!ocrState || ocrState.phase !== 'confirm') return
    const { mapPrintedPages } = await import('../course/outlineOcr.ts')
    const title = ocrState.fileName.replace(/\.pdf$/i, '')
    const mapped = mapPrintedPages(ocrState.entries, ocrState.offset)
    const added = bookFromSections(title, mapped, ocrState.bookId)
    importBook(added)
    setBill({ fileName: ocrState.fileName, book: added })
    setOcrState(null)
    setImportState({ status: 'idle' })
    noteStorage('目录来自扫描件 OCR，页码按确认的偏移换算')
    const file = ocrFile.current
    if (file) await saveIfWanted(file, added.id)
  }, [ocrState, saveIfWanted, setOcrState])

  /** 手动粘目录 → 建书；一行一章，格式同书签。 */
  const confirmManualOcr = useCallback(async () => {
    if (!ocrState || ocrState.phase !== 'failed') return
    const outline = await import('../course/pdfOutline.ts')
    const lines = ocrDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const entries = outline.chaptersFromTextLines(lines).filter((entry) => entry.depth === 0)
    if (entries.length === 0) {
      setOcrState({ ...ocrState, message: '这段文字里没认出「第N章」，一行写一章试试' })
      return
    }
    const title = ocrState.fileName.replace(/\.pdf$/i, '')
    const added = bookFromSections(title, entries, `imported-${Date.now()}`)
    importBook(added)
    setBill({ fileName: ocrState.fileName, book: added })
    setOcrState(null)
    setImportState({ status: 'idle' })
    noteStorage('目录是手动粘进来的')
    const file = ocrFile.current
    if (file) await saveIfWanted(file, added.id)
  }, [ocrDraft, ocrState, saveIfWanted, setOcrState])

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      const fileName = file.name
      if (!/\.pdf$/i.test(fileName)) {
        setImportState({ status: 'failed', fileName, message: '这里只认 PDF，选一个 .pdf 文件试试。' })
        return
      }
      if (file.size > MAX_PDF_BYTES) {
        setImportState({ status: 'failed', fileName, message: '这个文件超过 250 MB，先换一本小点的。' })
        return
      }
      setImportState({ status: 'parsing', fileName, slow: false })
      slowTimer.current = window.setTimeout(() => {
        setImportState((prev) => (prev.status === 'parsing' ? { ...prev, slow: true } : prev))
      }, SLOW_PARSE_MS)
      // 解析层整块懒加载：pdfOutline 和自己那套关键词表不进主包，
      // 只有真的选了文件才把这几个模块拉下来。
      const outline = await import('../course/pdfOutline.ts')
      try {
        const bytes = await file.arrayBuffer()
        const bookId = await stableBookId(fileName, new Uint8Array(bytes))
        const forceOcr = new URLSearchParams(window.location.search).get('noOutline') === '1'
        if (forceOcr) {
          setImportState({ status: 'idle' })
          await tryOcrOutline(file, fileName, bookId)
          return
        }
        const entries = await outline.parsePdfOutline(bytes)
        if (entries.length === 0) {
          // 扫描件没有书签、文字层也抠不出章名：先试 OCR 读目录页，失败再退回手动输入。
          setImportState({ status: 'idle' })
          await tryOcrOutline(file, fileName, bookId)
          return
        }
        const title = fileName.replace(/\.pdf$/i, '')
        const added = bookFromSections(title, entries, bookId)
        importBook(added)
        setBill({ fileName, book: added })
        setImportState({ status: 'idle' })
        // 目录已经进内存、也落了盘；原文件按开关与空间另存，存不下不影响这本书能不能用。
        noteStorage(null)
        if (!getShelf().keepPdf) {
          noteStorage('这次只存了目录（「导入时同时保存原文件」关着）')
          return
        }
        const saved = await saveOriginalPdf(file, added.id)
        if (saved.status === 'saved') markPdfSaved(added.id, saved.bytes)
        else noteStorage(saved.message)
      } catch (error) {
        setImportState({
          status: 'failed',
          fileName,
          message: error instanceof outline.PdfOutlineError ? error.message : '这本 PDF 读不动，换一本试试。',
        })
      } finally {
        stopSlowTimer()
      }
    },
    [stopSlowTimer, tryOcrOutline],
  )

  /** 一章里挑第一个真能玩的，挑不到就回默认起始章。 */
  const firstPlayable = useCallback((target: ShelfBook): number => {
    const first = target.chapters.find((entry) => isPlayable(entry))
    return first?.topicId ? Number(first.topicId) : START_CHAPTER
  }, [])

  const useThisBook = useCallback(() => {
    if (!bill) return
    setActive(bill.book.id)
    pick(firstPlayable(bill.book))
    setBill(null)
    setSwitching(false)
  }, [bill, firstPlayable, pick])

  const dismissBill = useCallback(() => setBill(null), [])

  const switchBook = useCallback(
    (id: string) => {
      const target = bookById(books, id)
      setActive(target.id)
      pick(firstPlayable(target))
      setSwitching(false)
    },
    [firstPlayable, pick, books],
  )

  const dropBook = useCallback(
    (id: string) => {
      if (id === DEFAULT_BOOK_ID) return
      removeBookById(id)
      if (id === activeId) {
        pick(firstPlayable(defaultShelfBook()))
      }
    },
    [activeId, firstPlayable, pick],
  )

  const rows = useMemo<TreeRow[]>(() => {
    if (usingDefault) {
      return COURSE_CHAPTERS.map((item) => ({
        key: `default-${item.no}`,
        mark: DEEP_LAB_CHAPTERS.includes(item.no) ? '●' : '○',
        done: item.implemented,
        no: String(item.no).padStart(2, '0'),
        title: item.title,
        note: null,
        active: item.no === no,
        disabled: false,
        onPick: () => pick(item.no),
      }))
    }
    return book.chapters.map((entry, index) => {
      const target = entry.topicId ? chapterByNo(Number(entry.topicId)) : undefined
      return {
        key: `book-${index}`,
        mark: target ? '●' : '○',
        done: Boolean(target?.implemented),
        no: String(entry.no ?? index + 1).padStart(2, '0'),
        title: target ? `第 ${target.no} 章 · ${target.title}` : entry.rawTitle,
        note: target ? null : '暂无仿真',
        active: Boolean(target) && target!.no === no,
        disabled: !target,
        onPick: () => {
          if (target) pick(target.no)
        },
      }
    })
  }, [book, no, pick, usingDefault])

  return (
    <main className="lab course">
      <a className="back" href="#/">
        ← 返回首页
      </a>
      <header className="lab-head">
        <p className="eyebrow">课程视图 · {usingDefault ? '13 章' : book.title}</p>
        <h1>把整本书摊成 13 格，一次只看一格</h1>
        <p className="lede">
          左边是目录，点一章，右边给一屏：一句话问题、两三个滑块、一张图、三个读数、一句话结论。
          {usingDefault
            ? ' 13 章全部能拖，另有实验台可以直接跳到对应的交互页。'
            : ' 现在用的是你导入的教材，目录存在这台机器的浏览器里，刷新后仍是这一本。'}
        </p>
      </header>

      <section className="textbook-bar">
        <div className="textbook-head">
          <p className="textbook-current">
            当前教材：<strong>{book.title}</strong>
          </p>
          <div className="textbook-actions">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="course-file"
              aria-label="导入教材 PDF"
              onChange={(event) => {
                void handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <button type="button" className="course-btn ghost" onClick={() => fileRef.current?.click()}>
              导入一本书
            </button>
            <button
              type="button"
              className="course-btn ghost"
              onClick={() => setSwitching((open) => !open)}
            >
              {switching ? '收起' : '切换'}
            </button>
          </div>
        </div>
        <p className="textbook-note">
          目录存在这台机器的浏览器里，刷新后还是这一本，要换书点「切换」；原文件按书架面板的
          「导入时同时保存原文件」开关决定存不存，存不存都不上传。
        </p>
        {switching ? (
          <ul className="textbook-list">
            {books.map((item) => {
              const stat = billOf(item)
              return (
                <li key={item.id}>
                  <span className="textbook-list-title">{item.title}</span>
                  <span className="textbook-list-bill">
                    {stat.playable} / {stat.total} 章能玩
                  </span>
                  <button
                    type="button"
                    className="course-btn ghost"
                    onClick={() => switchBook(item.id)}
                    disabled={item.id === book.id}
                  >
                    {item.id === book.id ? '使用中' : '用这本'}
                  </button>
                  <button
                    type="button"
                    className="course-btn ghost"
                    onClick={() => dropBook(item.id)}
                    disabled={item.id === DEFAULT_BOOK_ID}
                  >
                    移除
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      {usingDefault || !hasPdf ? null : (
        <p className="course-scan-note">
          {scanState?.key === book.id && scanState.progress
            ? `扫描版 · 正在识别正文 ${scanState.progress.done}/${scanState.progress.total} 章`
            : null}
          {scanState?.key === book.id && scanState.scans
            ? `扫描版 · 正文已识别 ${scanState.scans.filter((scan) => scan.chars > 80).length}/${book.chapters.length} 章`
            : null}
          {scanState?.key === book.id && scanState.note ? `正文识别没成：${scanState.note}` : null}
        </p>
      )}
      <div className="course-book-toggle">
        <button type="button" className="course-book-toggle-btn" onClick={() => setShowBook((open) => !open)}>
          {showBook ? '收起书栏' : '同屏看书'}
        </button>
      </div>

      <div className={`course-layout${showBook ? ' with-book' : ''}`}>
        <div className="course-side">
          {importState.status === 'parsing' ? (
            <p className="course-import-status">
              正在读《{importState.fileName}》的目录…
              {importState.slow ? ' 还在解析，大文件要等一会儿，可以继续等。' : ''}
            </p>
          ) : null}

          {importState.status === 'failed' ? (
            <p className="course-import-status failed">{importState.message}</p>
          ) : null}

          {ocrState && ocrState.phase === 'reading' ? (
            <div className="course-ocr" role="status">
              <p>
                正在识别目录页 {ocrState.page}/{ocrState.total}…
              </p>
              <button
                type="button"
                className="course-btn ghost"
                onClick={() => ocrAbort.current?.abort()}
              >
                取消
              </button>
            </div>
          ) : null}

          {ocrState && ocrState.phase === 'confirm' ? (
            <div className="course-ocr" role="dialog" aria-label="确认目录">
              <p className="course-preview-title">{ocrState.fileName}</p>
              <p className="course-preview-meta">
                从目录页认出 {ocrState.entries.length} 章。页码是书上印的；PDF 页 = 书内页 + 偏移。
              </p>
              <ul className="course-ocr-list">
                {ocrState.entries.map((entry, index) => (
                  <li key={`ocr-${index}`}>
                    <span className="course-ocr-title">{entry.rawTitle}</span>
                    <input
                      type="number"
                      min={1}
                      aria-label={`${entry.rawTitle} 的书内页码`}
                      value={entry.page ?? 1}
                      onChange={(event) => {
                        const page = Number(event.target.value)
                        setOcrState((prev) =>
                          prev && prev.phase === 'confirm'
                            ? {
                                ...prev,
                                entries: prev.entries.map((item, i) =>
                                  i === index ? { ...item, page } : item,
                                ),
                              }
                            : prev,
                        )
                      }}
                    />
                  </li>
                ))}
              </ul>
              <label className="course-ocr-offset">
                偏移
                <input
                  type="number"
                  aria-label="PDF 页与书内页的偏移"
                  value={ocrState.offset}
                  onChange={(event) => {
                    const offset = Number(event.target.value)
                    setOcrState((prev) =>
                      prev && prev.phase === 'confirm' ? { ...prev, offset } : prev,
                    )
                  }}
                />
              </label>
              <div className="course-actions">
                <button type="button" className="course-btn" onClick={() => void confirmOcrBook()}>
                  按这张表建书
                </button>
                <button type="button" className="course-btn ghost" onClick={() => setOcrState(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {ocrState && ocrState.phase === 'failed' ? (
            <div className="course-ocr" role="dialog" aria-label="手动输目录">
              <p className="course-preview-title">自动识别没成</p>
              <p className="course-preview-meta">{ocrState.message}。把目录粘在下面，一行一章。</p>
              <textarea
                className="course-ocr-manual"
                rows={6}
                aria-label="手动输入章名"
                value={ocrDraft}
                onChange={(event) => setOcrDraft(event.target.value)}
                placeholder={'第1章 绪论\n第2章 确知信号'}
              />
              <div className="course-actions">
                <button type="button" className="course-btn" onClick={() => void confirmManualOcr()}>
                  用这段文字建书
                </button>
                <button type="button" className="course-btn ghost" onClick={() => setOcrState(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {bill && billStat ? (
            <div className="course-bill" role="dialog" aria-label="教材账单">
              <p className="course-preview-title">{bill.book.title}</p>
              <p className="course-preview-meta">
                来自《{bill.fileName}》：只读了书签，正文一个字节都没留。
              </p>
              <ul className="course-bill-lines">
                <li>识别到 {billStat.total} 章</li>
                <li>其中 {billStat.playable} 章有可交互模型</li>
                <li>
                  其余 {billStat.uncovered} 章：{UNCOVERED_NOTE}
                </li>
              </ul>
              <ol className="course-bill-list">
                {bill.book.chapters.map((entry, index) => (
                  <li key={`bill-${index}`} className={isPlayable(entry) ? undefined : 'miss'}>
                    <span className="course-bill-title">{entry.rawTitle}</span>
                    <span className="course-bill-evidence">{evidenceOf(entry)}</span>
                  </li>
                ))}
              </ol>
              <div className="course-actions">
                <button type="button" className="course-btn" onClick={useThisBook}>
                  用这本书
                </button>
                <button type="button" className="course-btn ghost" onClick={dismissBill}>
                  先不看
                </button>
              </div>
            </div>
          ) : (
            <CourseTree rows={rows} />
          )}
        </div>

        <section className="course-main">
          {view ? (
            <ChapterScreen
              chapter={chapter}
              params={params}
              onChange={setParam}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onFail={onFail}
              onReset={onReset}
              view={view}
              evidence={chapterScanOf(no)}
              onJump={(next) => pick(next)}
              onJumpPage={(next) => {
                setShowBook(true)
                changeBookPage(next)
              }}
            />
          ) : (
            <TodoScreen chapter={chapter} />
          )}
        </section>

        {showBook ? (
          <aside className="course-book-pane" aria-label="教材原文">
            <button type="button" className="course-book-close" onClick={() => setShowBook(false)} aria-label="收起书栏">
              收起
            </button>
            {hasPdf ? (
              <PdfPane
                bookId={book.id}
                page={bookPage}
                onPageChange={changeBookPage}
                scale={bookScale}
                onScaleChange={setBookScale}
                chapterCount={book.chapters.length}
              />
            ) : (
              <p className="course-book-missing">
                本书只保存了目录，要看正文请重新导入并勾选保存原文件
              </p>
            )}
          </aside>
        ) : null}
      </div>
    </main>
  )
}

function TodoScreen({ chapter }: { chapter: CourseChapter }) {
  return (
    <section className="course-todo">
      <p className="eyebrow">第 {chapter.no} 章 · {chapter.title}</p>
      <h2>未实现</h2>
      <p className="course-reason">{chapter.reason}</p>
      <CourseLabs labs={chapter.labs} />
    </section>
  )
}
