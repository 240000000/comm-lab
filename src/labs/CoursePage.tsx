/**
 * 课程视图。
 *
 * 左边是教材的 13 章目录，右边只渲染当前这一章的一屏：
 * 一句话问题、两三个滑块、一张图、三个读数、一句话结论。
 * 每章的计算都在 src/core/course.ts 里，页面只负责把参数递进去、把结果摆出来。
 */
import { useMemo, useState } from 'react'
import {
  COURSE_CHAPTERS,
  DEEP_LAB_CHAPTERS,
  chapterByNo,
  type CourseChapter,
  type CourseParam,
  type CourseView,
} from '../core/course.ts'
import { CourseChart } from './CourseChart.tsx'

const START_CHAPTER = 2

/** 地址里带 ?no=5 时直接打开第 5 章，截图与分享都用得上。 */
function initialChapter(): number {
  const query = window.location.hash.split('?')[1] ?? ''
  const no = Number(new URLSearchParams(query).get('no'))
  return chapterByNo(no) ? no : START_CHAPTER
}

export function CoursePage() {
  const [no, setNo] = useState(initialChapter)
  const chapter = chapterByNo(no) ?? chapterByNo(START_CHAPTER)!
  const [params, setParams] = useState<Record<string, number>>(chapter.defaults)

  const view = useMemo(
    () => (chapter.compute ? chapter.compute(params) : null),
    [chapter, params],
  )

  function pick(next: number) {
    const target = chapterByNo(next)
    if (!target) return
    setNo(next)
    setParams(target.defaults)
  }

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
        <nav className="course-tree" aria-label="课程目录">
          {COURSE_CHAPTERS.map((item) => (
            <button
              key={item.no}
              type="button"
              className={`course-item${item.no === no ? ' active' : ''}`}
              onClick={() => pick(item.no)}
            >
              <span className={`course-mark${item.implemented ? ' done' : ''}`}>
                {DEEP_LAB_CHAPTERS.includes(item.no) ? '●' : '○'}
              </span>
              <span className="course-no">{String(item.no).padStart(2, '0')}</span>
              <span className="course-title">{item.title}</span>
            </button>
          ))}
        </nav>

        <section className="course-main">
          {view ? (
            <ChapterScreen
              chapter={chapter}
              params={params}
              onChange={(key, value) => setParams((prev) => ({ ...prev, [key]: value }))}
              onFail={() => setParams(chapter.failPreset)}
              onReset={() => setParams(chapter.defaults)}
              view={view}
            />
          ) : (
            <TodoScreen chapter={chapter} />
          )}
        </section>
      </div>
    </main>
  )

function Control({
  param,
  value,
  onChange,
}: {
  param: CourseParam
  value: number
  onChange: (value: number) => void
}) {
  if (param.options) {
    return (
      <label className="control">
        <span className="control-label">
          {param.label}
          <b>{param.options[value]}</b>
        </span>
        <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
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
    <label className="control">
      <span className="control-label">
        {param.label}
        <b>
          {value}
          {param.unit}
        </b>
      </span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function ChapterScreen({
  chapter,
  params,
  onChange,
  onFail,
  onReset,
  view,
}: {
  chapter: CourseChapter
  params: Record<string, number>
  onChange: (key: string, value: number) => void
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
            param={param}
            value={params[param.key]}
            onChange={(value) => onChange(param.key, value)}
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
}
