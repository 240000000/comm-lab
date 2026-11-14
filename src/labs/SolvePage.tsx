import { useEffect, useRef, useState } from 'react'
import './solve-page.css'
import { recognizeImage } from '../course/ocrImage.ts'
import {
  ANSWER_BANK,
  MODEL_ERROR_TAIL,
  NO_CHAPTER_HINT,
  DEFAULT_FRAME_HINT,
  OFFLINE_ONLY_HINT,
  chapterTitle,
  noSampleHint,
  pickProblem,
  problemByChapter,
  type BankProblem,
} from '../answer/bank.ts'
import { locateProblem, type LocateOutcome } from '../answer/locate.ts'
import { bandMissNote, channelPreset, encodePreset, type PresetSpec } from '../answer/presets.ts'
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

/** 计时起点。
 * 放到模块级是为了让 react(purity) 规则别把「读时钟」当成渲染期调用——
 * 本文件里所有取时间戳的地方都只在事件回调或异步流程里执行。
 */
const nowMs = () => performance.now()

const IDLE_NOTE = '上传一张题目截图，或者直接点下面的内置样本——接了模型就让模型看图答，没接就走离线三题。'

/**
 * 右栏 iframe 的地址。
 *
 * `?no=` 是 CoursePage 已经支持的章节参数；`embed=1` 是这一轮新加的精简形态，
 * 课程视图会把 hero、教材栏、左侧章列表都收起来，只留当前章一屏五段。
 */
function courseUrl(chapter: number, preset?: PresetSpec): string {
  const { origin, pathname } = window.location
  const parts = [chapter > 0 ? `no=${chapter}` : '', 'embed=1']
  if (preset) parts.push(`preset=${encodeURIComponent(encodePreset(preset))}`)
  return `${origin}${pathname}#/course?${parts.filter(Boolean).join('&')}`
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
  const [showConfig, setShowConfig] = useState(false)
  // 进度态：模型这一趟可以走十几秒，界面得一直说话，不能只转圈
  const [phase, setPhase] = useState('')
  const [waited, setWaited] = useState(0)
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

  // 等模型时每 200 ms 记一次用时，界面上的「已用时」才是活的
  useEffect(() => {
    if (model.kind !== 'pending') return
    const started = Date.now()
    const timer = window.setInterval(() => setWaited(Date.now() - started), 200)
    return () => window.clearInterval(timer)
  }, [model.kind])

  /**
   * 接上端点时走这条：原图直接给模型，本机 OCR 一步都不做。
   * 返回 true 表示这一轮已经处理完（成功或失败）；返回 false 表示端点其实没成，退回本机那条路。
   */
  const askModelFirst = async (blob: Blob, label: string): Promise<boolean> => {
    setPhase('发送中')
    setNote(`${label}：原图直接发给模型，等它看图…`)
    const started = nowMs()
    // 图传完就是纯等模型，400 ms 后把话术换成「等模型看图」
    const waiting = window.setTimeout(() => setPhase('等模型看图'), 400)
    const reply: AnswerReply = await defaultProvider({ image: blob, text: '', topicId: 0 })
    window.clearTimeout(waiting)
    if (!alive.current) return true

    if (reply.status === 'error') {
      // 模型失败就只报错，绝不拿内置答案顶上。
      setPhase('')
      setModel({ kind: 'error', message: reply.message })
      setNote(`${label}：模型这次没答上来（${seconds(nowMs() - started)}）。`)
      return true
    }
    if (reply.status === 'offline') {
      // 端点没配成：退回收机识别那条老路，行为与「没端点」完全一致。
      setPhase('')
      setModel({ kind: 'pending' })
      return false
    }

    setPhase('解析中')
    const transcript = reply.meta.transcript ?? ''
    // 题面与章节都来自模型那段 JSON：不再本机认字、不再本机打分定位。
    const placed: LocateOutcome | null = reply.meta.chapter
      ? { chapter: reply.meta.chapter, hits: [], score: 0, top: [], ambiguous: false }
      : null
    setText(transcript)
    setLocated(placed)
    setProblem(placed ? (pickProblem(transcript, placed.chapter) ?? null) : null)
    setModel({ kind: 'ok', answer: reply })
    setNote(`模型作答完成（${seconds(nowMs() - started)}）。`)
    return true
  }

  /** 拿到图之后：接上端点就直接看图作答，没端点才走本机识别链路。 */
  const readImage = async (blob: Blob, label: string) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(blob)
    setPreview(objectUrl.current)
    setText('')
    setLocated(null)
    setProblem(null)
    setWaited(0)
    setModel({ kind: 'pending' })

    if (wired === true) {
      const handled = await askModelFirst(blob, label)
      if (handled) return
    }

    setPhase('本机识别题面')
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
      ? (pickProblem(outcome.text, result.chapter) ?? null)
      : null
    setText(outcome.text)
    setLocated(result)
    setProblem(found)
    setNote(`识别完成（${seconds(outcome.ms)}）。`)

    setPhase('发送中')
    // 图传完就是纯等模型，400 ms 后把话术换成「等模型看图」
    const waiting = window.setTimeout(() => setPhase('等模型看图'), 400)
    const reply: AnswerReply = await defaultProvider({
      image: blob,
      text: outcome.text,
      topicId: result?.chapter ?? 0,
    })
    window.clearTimeout(waiting)
    if (!alive.current) return
    setPhase('解析中')
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
    // 只按题面匹配：对不上就是 null，绝不拿同章另一道题顶上。
    setProblem(pickProblem(text, chapter) ?? null)
  }

  const chapter = located?.chapter ?? 0
  const chapterSample = chapter > 0 ? problemByChapter(chapter) : undefined
  const demoAnswer = model.kind === 'offline' ? (problem?.answer ?? null) : null
  const answer = model.kind === 'ok' ? model.answer : demoAnswer
  const preset = answer?.preset
  // 第 4 章档位对不上时宁可说清楚，也不用最近档位假对齐。
  const bandMiss = (() => {
    if (chapter !== 4 || !problem) return ''
    const band = problem.answer.params.find((p) => p.key === 'bandKhz')?.value
    const snrDb = problem.answer.params.find((p) => p.key === 'snDb')?.value
    if (band === undefined || snrDb === undefined) return ''
    const match = channelPreset({ bandKhz: band, snrDb })
    return match.status === 'no-exact-band' ? bandMissNote(match) : ''
  })()
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
            {wired === false ? (
              <p className="solve-note solve-offline-only">{OFFLINE_ONLY_HINT}</p>
            ) : null}
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
            {transcript ? (
              <p className="solve-text">{transcript}</p>
            ) : text ? (
              <pre className="solve-text">{text}</pre>
            ) : (
              <p className="solve-note">还没有识别结果。</p>
            )}
            {transcript && text && text !== transcript ? (
              <details className="solve-raw">
                <summary>查看原始识别</summary>
                <pre className="solve-text">{text}</pre>
              </details>
            ) : null}
            {located ? (
              <p className="solve-locate">
                已定位到第 {located.chapter} 章 · {chapterTitle(located.chapter)}
                {located.hits.length > 0 ? ` · 命中词：${located.hits.join('、')}` : ''}
              </p>
            ) : null}
            {bandMiss ? <p className="solve-locate solve-error">{bandMiss}</p> : null}
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
                <span className="solve-badge ok">模型作答</span>
                <p className="solve-headline">{model.answer.headline}</p>
                <p className="solve-note">{metaLine(model.answer)}</p>
              </>
            ) : null}
            {model.kind === 'pending' ? (
              <p className="solve-progress">
                {phase || '正在准备'} · 已用时 {seconds(waited)}
              </p>
            ) : null}
            {model.kind === 'error' ? (
              <p className="solve-locate solve-error">
                模型这次没答上来：{model.message}。没有回退成演示答案，可以重传一次或检查端点配置。{MODEL_ERROR_TAIL}
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
              chapter > 0 ? (
                <div>
                  <p className="solve-note">{noSampleHint(wired === true)}</p>
                  <div>
                    {chapterSample ? (
                      <button
                        type="button"
                        className="solve-sample"
                        style={{ marginRight: 8 }}
                        onClick={() => void loadSample(chapterSample)}
                      >
                        用该章示例题试试
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="solve-sample"
                      onClick={() => setShowConfig((open) => !open)}
                    >
                      怎么配置
                    </button>
                  </div>
                  {showConfig ? (
                    <p className="solve-note">
                      在仓库里放 public/answer-config.json，把 endpoint 填成你的 OpenAI 兼容地址；key
                      只放在服务端转发，不写进仓库。没配端点时就是现在这个离线模式。
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="solve-note">{NO_CHAPTER_HINT}</p>
              )
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
            {answer?.caveat ? (
              <p className="solve-caveat">
                {model.kind === 'ok' ? '模型备注：' : ''}
                {answer.caveat}
              </p>
            ) : null}
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
          {chapter > 0 && !preset ? (
            <p className="solve-note solve-default-frame">{DEFAULT_FRAME_HINT}</p>
          ) : null}
          {chapter > 0 ? (
            <iframe
              key={`${chapter}:${preset ? encodePreset(preset) : ''}`}
              className="solve-frame"
              src={courseUrl(chapter, preset)}
              title={`第 ${chapter} 章课程视图`}
            />
          ) : (
            <div className="solve-frame-empty">
              <p>上传截图后，这里自动打开定位到的章节。</p>
              <p className="solve-note">有题目参数时，这里会按题设把右栏调好，让两边读数对得上。</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}