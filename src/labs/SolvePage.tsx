import { useEffect, useRef, useState } from 'react'
import './solve-page.css'
import { recognizeImage } from '../course/ocrImage.ts'
import { ANSWER_BANK, chapterTitle, problemByChapter, type BankProblem } from '../answer/bank.ts'
import { locateProblem, type LocateOutcome } from '../answer/locate.ts'
import {
  defaultProvider,
  hasModelEndpoint,
  type AnswerOk,
  type AnswerReply,
} from '../answer/provider.ts'

/**
 * 模型的三种下场：没接、答了、这次失败。
 * 失败必须单独占一态——绝不能拿内置答案顶上，否则满屏都是「假模型」。
 */
type ModelState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; answer: AnswerOk }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

const IDLE_NOTE = '上传一张题目截图，或者直接点下面的内置样本——接了模型就让模型看图答，没接就走离线三题。'

/**
 * 右栏 iframe 的地址。
 *
 * `?no=` 是 CoursePage 已经支持的章节参数；`embed=1` 是这一轮新加的精简形态，
 * 课程视图会把 hero、教材栏、左侧章列表都收起来，只留当前章一屏五段。
 */
function courseUrl(chapter: number): string {
  const { origin, pathname } = window.location
  const query = chapter > 0 ? `no=${chapter}&embed=1` : 'embed=1'
  return `${origin}${pathname}#/course?${query}`
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

/** 模型作答的元信息，横着排一行：耗时、token、置信度。 */
function metaLine(reply: AnswerOk): string {
  const parts: string[] = []
  if (reply.meta.model) parts.push(reply.meta.model)
  if (typeof reply.meta.ms === 'number') parts.push(seconds(reply.meta.ms))
  if (typeof reply.meta.promptTokens === 'number' || typeof reply.meta.completionTokens === 'number') {
    parts.push(`token ${reply.meta.promptTokens ?? '?'} → ${reply.meta.completionTokens ?? '?'}`)
  }
  if (typeof reply.meta.confidence === 'number') {
    parts.push(`置信度 ${(reply.meta.confidence * 100).toFixed(0)}%`)
  }
  return parts.join(' · ')
}

export default function SolvePage() {
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [located, setLocated] = useState<LocateOutcome | null>(null)
  const [problem, setProblem] = useState<BankProblem | null>(null)
  const [model, setModel] = useState<ModelState>({ kind: 'idle' })
  const [note, setNote] = useState(IDLE_NOTE)
  const [wired, setWired] = useState<boolean | null>(null)
  const objectUrl = useRef('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void hasModelEndpoint().then((found) => {
      if (alive.current) setWired(found)
    })
    return () => {
      alive.current = false
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    }
  }, [])

  /** 拿到图之后：先本机认一遍（题面展示 + 定位），再把原图直接发给模型。 */
  const readImage = async (blob: Blob, label: string) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(blob)
    setPreview(objectUrl.current)
    setText('')
    setLocated(null)
    setProblem(null)
    setModel({ kind: 'pending' })
    setNote(`${label}：正在识别…`)

    const outcome = await recognizeImage(blob)
    if (!alive.current) return
    if (!outcome.ok) {
      setNote(outcome.message)
      setModel({ kind: 'idle' })
      return
    }

    const result = locateProblem(outcome.text)
    const found = result && !result.ambiguous
      ? (problemByChapter(result.chapter) ?? null)
      : null
    setText(outcome.text)
    setLocated(result)
    setProblem(found)
    setNote(`识别完成（${seconds(outcome.ms)}）。`)

    const reply: AnswerReply = await defaultProvider({
      image: blob,
      text: outcome.text,
      topicId: result?.chapter ?? 0,
    })
    if (!alive.current) return
    if (reply.status === 'ok') setModel({ kind: 'ok', answer: reply })
    else if (reply.status === 'offline') setModel({ kind: 'offline' })
    else setModel({ kind: 'error', message: reply.message })
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void readImage(file, file.name)
  }

  const loadSample = async (item: BankProblem) => {
    setNote(`正在载入样本「${item.title}」…`)
    const response = await fetch(`${import.meta.env.BASE_URL}${item.sample}`)
    if (!response.ok) {
      setNote(`样本图取不到（${response.status}），检查 public/answer-samples/。`)
      return
    }
    await readImage(await response.blob(), item.title)
  }

  const pickChapter = (chapter: number) => {
    if (!located) return
    setLocated({ ...located, chapter, ambiguous: false })
    setProblem(problemByChapter(chapter) ?? null)
  }

  const chapter = located?.chapter ?? 0
  const demoAnswer = model.kind === 'offline' ? (problem?.answer ?? null) : null
  const answer = model.kind === 'ok' ? model.answer : demoAnswer
  const formula = problem?.formula ?? ''
  const transcript = model.kind === 'ok' ? model.answer.meta.transcript : undefined

  return (
    <main className="lab solve">
      <header className="solve-head">
        <h1>答题模式</h1>
        <p className="solve-sub">
          上传题目截图：接了模型就把原图直接交给模型作答；没接模型时本机识别、内置题库演示。
        </p>
        <a className="solve-back" href="#/">
          返回首页
        </a>
      </header>

      <div className="solve-grid">
        <section className="solve-left">
          <article className="solve-card">
            <h2>1 · 上传题目截图</h2>
            <div className="solve-upload">
              <label className="solve-btn">
                选择截图
                <input className="solve-file" type="file" accept="image/*" onChange={onPick} />
              </label>
              {ANSWER_BANK.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="solve-sample"
                  onClick={() => void loadSample(item)}
                >
                  样本：{item.title}
                </button>
              ))}
            </div>
            {preview ? <img className="solve-preview" src={preview} alt="题目截图预览" /> : null}
            <p className="solve-note" title={note}>
              {note}
            </p>
          </article>

          <article className="solve-card">
            <h2>2 · 识别出的题面</h2>
            {text ? <pre className="solve-text">{text}</pre> : <p className="solve-note">还没有识别结果。</p>}
            {transcript ? <p className="solve-note">模型读图得到的题面：{transcript}</p> : null}
            {located ? (
              <p className="solve-locate">
                已定位到第 {located.chapter} 章 · {chapterTitle(located.chapter)}
                {located.hits.length > 0 ? ` · 命中词：${located.hits.join('、')}` : ''}
              </p>
            ) : null}
            {located?.ambiguous ? (
              <div className="solve-top3">
                <p className="solve-note">命中不明显，自己挑一个：</p>
                <div className="solve-top3-list">
                  {located.top.map((item) => (
                    <button
                      key={item.topicId}
                      type="button"
                      className="solve-sample"
                      onClick={() => pickChapter(Number(item.topicId.replace('ch', '')))}
                    >
                      第 {Number(item.topicId.replace('ch', ''))} 章 · {chapterTitle(Number(item.topicId.replace('ch', '')))}（{item.score}）
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </article>

          <article className="solve-card">
            <h2>3 · 答案</h2>
            {model.kind === 'ok' ? (
              <>
                <span className="solve-badge ok">模型作答（图片直传）</span>
                <p className="solve-headline">{model.answer.headline}</p>
                <p className="solve-note">{metaLine(model.answer)}</p>
              </>
            ) : null}
            {model.kind === 'pending' ? <p className="solve-note">模型正在看图，稍等…</p> : null}
            {model.kind === 'error' ? (
              <p className="solve-locate solve-error">
                模型这次没答上来：{model.message}。没有回退成演示答案，可以重传一次或检查端点配置。
              </p>
            ) : null}
            {demoAnswer ? (
              <>
                <span className="solve-badge demo">演示模式：未接模型，下面是从内置题库取的答案</span>
                <p className="solve-headline">{demoAnswer.headline}</p>
              </>
            ) : null}
            {formula ? <p className="solve-formula">{formula}</p> : null}
            {!answer && model.kind !== 'pending' && model.kind !== 'ok' && model.kind !== 'error' ? (
              <p className="solve-note">还没定位到题目。</p>
            ) : null}
            {answer && answer.params.length > 0 ? (
              <ul className="solve-params">
                {answer.params.map((param) => (
                  <li key={param.key}>
                    <span>{param.label}</span>
                    <strong>{param.value}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
            {answer?.caveat ? <p className="solve-caveat">{answer.caveat}</p> : null}
          </article>

          <article className="solve-card">
            <h2>4 · 关键步骤</h2>
            {answer ? (
              <ol className="solve-steps">
                {answer.steps.map((step, index) => (
                  <li key={`${index}-${step.slice(0, 8)}`}>{step}</li>
                ))}
              </ol>
            ) : model.kind === 'pending' ? (
              <p className="solve-note">等答案回来。</p>
            ) : (
              <p className="solve-note">还没有答案。</p>
            )}
          </article>
        </section>

        <aside className="solve-right">
          <div className="solve-frame-head">
            <h2>右栏 · 课程视图</h2>
            <span className="solve-hint">
              {chapter > 0 ? `第 ${chapter} 章 · ${chapterTitle(chapter)}` : '定位后自动打开对应章节'}
              {wired === null ? '' : wired ? ' · 模型已接' : ' · 离线模式'}
            </span>
          </div>
          {chapter > 0 ? (
            <iframe
              key={chapter}
              className="solve-frame"
              src={courseUrl(chapter)}
              title={`第 ${chapter} 章课程视图`}
            />
          ) : (
            <div className="solve-frame-empty">
              <p>上传截图后，这里自动打开定位到的章节。</p>
              <p className="solve-note">参数滑块留给下一轮，这一轮只做「自动打开对应章节」。</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}