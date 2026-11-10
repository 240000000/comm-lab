/**
 * 课程视图。
 *
 * 左边是教材的 13 章目录，右边只渲染当前这一章的一屏：
 * 一句话问题、两三个滑块、一张图、三个读数、一句话结论。
 * 每章的计算都在 src/core/course.ts 里，页面只负责把参数递进去、把结果摆出来。
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { createDragCoalescer } from './dragCommit'
import {
  COURSE_CHAPTERS,
  DEEP_LAB_CHAPTERS,
  chapterByNo,
  type CourseChapter,
  type CourseParam,
  type CourseView,
} from '../core/course.ts'
import { CourseChart } from './CourseChart.tsx'
import { CourseLegend } from './CourseLegend.tsx'
import { ParamSlider } from './ParamSlider.tsx'
import type { OutlinedBook } from '../course/pdfOutline.ts'

const START_CHAPTER = 2

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
  onChange,
  onDragStart,
  onDragEnd,
}: {
  paramKey: string
  param: CourseParam
  value: number
  onChange: (key: string, value: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const handleChange = useCallback((next: number) => onChange(paramKey, next), [onChange, paramKey])

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
      max={param.max}
      step={param.step}
      unit={param.unit}
      onChange={handleChange}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    />
  )
})

const ChapterScreen = memo(function ChapterScreen({
  chapter,
  params,
  onChange,
  onDragStart,
  onDragEnd,
  onFail,
  onReset,
  view,
}: {
  chapter: CourseChapter
  params: Record<string, number>
  onChange: (key: string, value: number) => void
  onDragStart: () => void
  onDragEnd: () => void
  onFail: () => void
  onReset: () => void
  view: CourseView
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
            onChange={onChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>

      <div className="course-chart">
        <CourseLegend series={view.series} />
        <CourseChart
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
        <div className="course-actions">
          <button type="button" className="course-btn" onClick={onFail}>
            让它失效
          </button>
          <button type="button" className="course-btn ghost" onClick={onReset}>
            回到默认
          </button>
        </div>
      </section>
    </>
  )
})

const MAX_PDF_BYTES = 250 * 1024 * 1024
const SLOW_PARSE_MS = 15_000

type ImportPreview = { fileName: string; book: OutlinedBook; playable: number }

type ImportState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string; slow: boolean }
  | { status: 'preview'; preview: ImportPreview }
  | { status: 'failed'; fileName: string; message: string }

export function CoursePage() {
  const [no, setNo] = useState(initialChapter)
  const chapter = chapterByNo(no) ?? chapterByNo(START_CHAPTER)!
  const [params, setParams] = useState<Record<string, number>>(chapter.defaults)
  const [committed, setCommitted] = useState<Record<string, number>>(chapter.defaults)
  const dragRef = useRef(createDragCoalescer<Record<string, number>>())
  const paramsRef = useRef(params)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })
  const [imported, setImported] = useState<ImportPreview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const slowTimer = useRef<number | null>(null)

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
    paramsRef.current = next
    setParams(next)
    dragRef.current.push(next, setCommitted)
  }, [])

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
        const entries = await outline.parsePdfOutline(await file.arrayBuffer())
        if (entries.length === 0) {
          setImportState({
            status: 'failed',
            fileName,
            message: '这本书没有书签，文字层也抠不出章名（大概是扫描件）。这种书请手动输章名。',
          })
          return
        }
        const book = { ...outline.toBook(entries), title: fileName.replace(/\.pdf$/i, '') }
        const playable = book.chapters.filter(
          (entry) => entry.topicId && chapterByNo(Number(entry.topicId)),
        ).length
        setImportState({ status: 'preview', preview: { fileName, book, playable } })
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
    [stopSlowTimer],
  )

  const useThisBook = useCallback(() => {
    setImportState((prev) => {
      if (prev.status !== 'preview') return prev
      setImported(prev.preview)
      const first = prev.preview.book.chapters.find((entry) => entry.topicId)
      if (first?.topicId) pick(Number(first.topicId))
      return { status: 'idle' }
    })
  }, [pick])

  const cancelImport = useCallback(() => setImportState({ status: 'idle' }), [])

  const restoreDefault = useCallback(() => {
    setImported(null)
    setImportState({ status: 'idle' })
    pick(START_CHAPTER)
  }, [pick])

  const rows = useMemo<TreeRow[]>(() => {
    if (!imported) {
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
    return imported.book.chapters.map((entry, index) => {
      const target = entry.topicId ? chapterByNo(Number(entry.topicId)) : undefined
      return {
        key: `book-${index}`,
        mark: target ? '●' : '○',
        done: Boolean(target?.implemented),
        no: String(entry.no ?? index + 1).padStart(2, '0'),
        title: target ? `第 ${target.no} 章 · ${target.title}` : entry.rawTitle,
        note: target
          ? entry.page === null
            ? 'PDF 页码未标'
            : `PDF 第 ${entry.page} 页`
          : '暂无仿真',
        active: Boolean(target) && target!.no === no,
        disabled: !target,
        onPick: () => {
          if (target) pick(target.no)
        },
      }
    })
  }, [imported, no, pick])

  return (
    <main className="lab course">
      <a className="back" href="#/">
        ← 返回首页
      </a>
      <header className="lab-head">
        <p className="eyebrow">课程视图 · {imported ? imported.book.title : '13 章'}</p>
        <h1>把整本书摊成 13 格，一次只看一格</h1>
        <p className="lede">
          左边是目录，点一章，右边给一屏：一句话问题、两三个滑块、一张图、三个读数、一句话结论。
          {imported
            ? ' 现在用的是你导入的教材，目录只在内存里，刷新就回到默认 13 章。'
            : ' 13 章全部能拖，另有实验台可以直接跳到对应的交互页。'}
        </p>
      </header>

      <div className="course-layout">
        <div className="course-side">
          <div className="course-import-bar">
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
              导入教材
            </button>
            {imported ? (
              <button type="button" className="course-btn ghost" onClick={restoreDefault}>
                恢复默认教材
              </button>
            ) : null}
          </div>
          <p className="course-import-note">
            {imported
              ? `当前《${imported.book.title}》：${imported.book.chapters.length} 章里 ${imported.playable} 章能玩。PDF 不上传、不落盘，刷新即失效。`
              : '选一本 .pdf，只读它的书签；不上传、不落盘，刷新就回默认 13 章。'}
          </p>

          {importState.status === 'parsing' ? (
            <p className="course-import-status">
              正在读《{importState.fileName}》的目录…
              {importState.slow ? ' 还在解析，大文件要等一会儿，可以继续等。' : ''}
            </p>
          ) : null}

          {importState.status === 'failed' ? (
            <p className="course-import-status failed">{importState.message}</p>
          ) : null}

          {importState.status === 'preview' ? (
            <div className="course-preview" role="dialog" aria-label="教材预览">
              <p className="course-preview-title">{importState.preview.book.title}</p>
              <p className="course-preview-meta">
                识别到 {importState.preview.book.chapters.length} 章，其中 {importState.preview.playable} 章有仿真。
              </p>
              <ol className="course-preview-list">
                {importState.preview.book.chapters.map((entry, index) => {
                  const target = entry.topicId ? chapterByNo(Number(entry.topicId)) : undefined
                  return (
                    <li key={`preview-${index}`} className={target ? undefined : 'miss'}>
                      <span>{target ? `第 ${target.no} 章 · ${target.title}` : entry.rawTitle}</span>
                      <span className="course-preview-page">
                        {target ? (entry.page === null ? 'PDF 页码未标' : `PDF 第 ${entry.page} 页`) : '暂无仿真'}
                      </span>
                    </li>
                  )
                })}
              </ol>
              <div className="course-actions">
                <button type="button" className="course-btn" onClick={useThisBook}>
                  用这本书
                </button>
                <button type="button" className="course-btn ghost" onClick={cancelImport}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <CourseTree rows={rows} />
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
            />
          ) : (
            <TodoScreen chapter={chapter} />
          )}
        </section>
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
      {chapter.labs?.length ? (
        <div className="course-links">
          {chapter.labs.map((lab) => (
            <a className="course-btn" key={lab.href} href={lab.href}>
              去{lab.label}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  )
}
