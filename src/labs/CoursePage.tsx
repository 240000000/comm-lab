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

const START_CHAPTER = 2

/** 地址里带 ?no=5 时直接打开第 5 章，截图与分享都用得上。 */
function initialChapter(): number {
  const query = window.location.hash.split('?')[1] ?? ''
  const no = Number(new URLSearchParams(query).get('no'))
  return chapterByNo(no) ? no : START_CHAPTER
}

/** 目录 13 项与拖动无关，单独拿出来 memo，切参数时不跟着重渲染。 */
const CourseTree = memo(function CourseTree({
  current,
  onPick,
}: {
  current: number
  onPick: (no: number) => void
}) {
  return (
    <nav className="course-tree" aria-label="课程目录">
      {COURSE_CHAPTERS.map((item) => (
        <button
          key={item.no}
          type="button"
          className={`course-item${item.no === current ? ' active' : ''}`}
          onClick={() => onPick(item.no)}
        >
          <span className={`course-mark${item.implemented ? ' done' : ''}`}>
            {DEEP_LAB_CHAPTERS.includes(item.no) ? '●' : '○'}
          </span>
          <span className="course-no">{String(item.no).padStart(2, '0')}</span>
          <span className="course-title">{item.title}</span>
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
        />
        <CourseLegend series={view.series} />
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

export function CoursePage() {
  const [no, setNo] = useState(initialChapter)
  const chapter = chapterByNo(no) ?? chapterByNo(START_CHAPTER)!
  const [params, setParams] = useState<Record<string, number>>(chapter.defaults)
  // 拖动中每隔一帧才算一次：params 是滑块与标签用的即时值，committed 才是喂给
  // compute 的值。松手时 end() 会用最后一次的即时值补算一遍，所以松手后看到的
  // 读数、结论、失效判据跟一次都没省过的完全一样，被省掉的只有中间帧。
  const [committed, setCommitted] = useState<Record<string, number>>(chapter.defaults)
  const dragRef = useRef(createDragCoalescer<Record<string, number>>())
  const paramsRef = useRef(params)

  const view = useMemo(
    () => (chapter.compute ? chapter.compute(committed) : null),
    [chapter, committed],
  )

  // 三个回调都固定住引用：不改的话每次渲染都是新闭包，
  // 下面 memo 过的目录和控件每帧都会跟着重渲染。
  const pick = useCallback((next: number) => {
    const target = chapterByNo(next)
    if (!target) return
    setNo(next)
    paramsRef.current = target.defaults
    setParams(target.defaults)
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
    paramsRef.current = chapter.failPreset
    setParams(chapter.failPreset)
    setCommitted(chapter.failPreset)
  }, [chapter])
  const onReset = useCallback(() => {
    paramsRef.current = chapter.defaults
    setParams(chapter.defaults)
    setCommitted(chapter.defaults)
  }, [chapter])

  return (
    <main className="lab course">
      <a className="back" href="#/">
        ← 返回首页
      </a>
      <header className="lab-head">
        <p className="eyebrow">课程视图 · 13 章</p>
        <h1>把整本书摊成 13 格，一次只看一格</h1>
        <p className="lede">
          左边是目录，点一章，右边给一屏：一句话问题、两三个滑块、一张图、三个读数、一句话结论。
          13 章全部能拖，每章都是一屏：一句话问题、两三个参数、一张图、三个读数、一句结论；点第 4、8、11 章能跳到对应的实验台。
        </p>
      </header>

      <div className="course-layout">
        <CourseTree current={no} onPick={pick} />

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
}
