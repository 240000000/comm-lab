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
import { locateProblem, MIN_SCORE, type LocateOutcome } from '../answer/locate.ts'
import { bandMissNote, channelPreset, encodePreset, type PresetSpec } from '../answer/presets.ts'
import { AnswerDiagram, type DiagramScheme } from './AnswerDiagram.tsx'
import {
  defaultProvider,
  hasModelEndpoint,
  type AnswerErrorKind,
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
  | { kind: 'error'; message: string; errorKind?: AnswerErrorKind }

/** 计时起点。
 * 放到模块级是为了让 react(purity) 规则别把「读时钟」当成渲染期调用——
 * 本文件里所有取时间戳的地方都只在事件回调或异步流程里执行。
 */
const nowMs = () => performance.now()

/**
 * 题面是不是要求画图：只认题面里的动词/名词，不听模型点头。
 * 「画出 / 试画」后面跟的十来个字当作要画的图名，写进「画不了」那句里。
 */
const DIAGRAM_ASK = /画出|试画|示意图|波形|星座图|眼图|频谱/

function asksDiagram(text: string): boolean {
  return DIAGRAM_ASK.test(text)
}

function askedSubject(text: string): string {
  if (/2DPSK/.test(text)) return '2DPSK 两种相位规则'
  if (/星座图/.test(text)) return '星座图'
  if (/眼图/.test(text)) return '眼图'
  if (/频谱图|功率谱/.test(text)) return '频谱图'
  const hit = text.match(/(?:画出|试画|作出|画)[^，。；\n]{0,12}/)
  return (hit?.[0] ?? '波形').replace(/^画出?/, '').trim() || '波形'
}

/**
 * 题面要的图，白名单画不出来的那些。
 *
 * 模型有时候会硬塞一个 psk-time 过来——2DPSK 的两种相位规则最能骗过它，
 * 画出来其实是 2PSK，读起来像对、其实不对。这里按题面盖掉模型的图，
 * 老实写「画不了」，而不是把 2DPSK 偷偷画成 2PSK。
 */
const DIAGRAM_OFF_LIMITS = /星座图|眼图|频谱图|功率谱|误码率曲线|2DPSK|DPSK/

function beyondWhitelist(text: string): boolean {
  return DIAGRAM_OFF_LIMITS.test(text)
}

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
  // 模型自报的章节：只作参考，和本机关键词不一致时在卡 2 下面说明
  const [modelChapter, setModelChapter] = useState<number | null>(null)
  const [problem, setProblem] = useState<BankProblem | null>(null)
  const [model, setModel] = useState<ModelState>({ kind: 'idle' })
  const [note, setNote] = useState(IDLE_NOTE)
  const [wired, setWired] = useState<boolean | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  // 进度态：模型这一趟可以走十几秒，界面得一直说话，不能只转圈
  const [phase, setPhase] = useState('')
  const [waited, setWaited] = useState(0)
  // 右栏 iframe 的高度由课程视图自报：一屏五段比 560px 高得多，钉死高度就只能内滚
  const [frameHeight, setFrameHeight] = useState(0)
  const objectUrl = useRef('')
  // 上一次上传的图：重试时直接复用，不让人重新选文件。
  const lastBlob = useRef<{ blob: Blob; label: string } | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; height?: unknown } | null
      if (!data || data.type !== 'comm-lab:embed-height') return
      if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      const next = Math.round(data.height)
      if (next < 260 || next > 4000) return
      setFrameHeight(next)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

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
      setModel({ kind: 'error', message: reply.message, errorKind: reply.errorKind })
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
    // 定位以本机为准：本机关键词分数够格就用本机结果，模型的章节只当参考。
    const local = locateProblem(transcript)
    const said = reply.meta.chapter && reply.meta.chapter >= 1 ? reply.meta.chapter : null
    const placed: LocateOutcome | null =
      local && local.score >= MIN_SCORE
        ? local
        : said
          ? { chapter: said, hits: [], score: local?.score ?? 0, top: [], ambiguous: false }
          : (local ?? null)
    setModelChapter(said)
    setText(transcript)
    setLocated(placed)
    setProblem(placed ? (pickProblem(transcript, placed.chapter) ?? null) : null)
    setModel({ kind: 'ok', answer: reply })
    setNote(`模型作答完成（${seconds(nowMs() - started)}）。`)
    return true
  }

  /** 拿到图之后：接上端点就直接看图作答，没端点才走本机识别链路。 */
  const readImage = async (blob: Blob, label: string) => {
    lastBlob.current = { blob, label }
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
    else setModel({ kind: 'error', message: reply.message, errorKind: reply.errorKind })
  }

  /** 重试：直接用上一张图再走一遍，不让人重新选文件。 */
  const retryModel = () => {
    const last = lastBlob.current
    if (!last) return
    void readImage(last.blob, last.label)
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
  // 「题目是否要求画图」只看题面本身：模型转写优先，其次本机 OCR
  const questionText = `${transcript ?? ''} ${text}`.trim()
  // 图上标相位得跟着题目问的调制走；题面里没提就按 2PSK（课本 7-4 那种问法）。
  const diagramScheme: DiagramScheme = /2DPSK|差分/i.test(transcript ?? text)
    ? '2DPSK'
    : /2ASK|ASK|通断键控/i.test(transcript ?? text)
      ? '2ASK'
      : '2PSK'

  return (
    <main className="lab solve">
      <header className="solve-head">
        <h1>答题模式</h1>
        <p className="solve-sub">
          上传题目截图：接了模型就把原图直接交给模型作答；没接模型时本机识别、内置题库演示。
        </p>
        <a className="limits-hint" href="#/limits?part=solve">
          已知限制 · 查看
        </a>
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
            {located && modelChapter && modelChapter !== located.chapter ? (
              <p className="solve-locate">
                模型说第 {modelChapter} 章，本机按关键词命中第 {located.chapter} 章
                {located.hits.length > 0 ? `（${located.hits.join(' / ')}）` : ''}
                <button
                  type="button"
                  className="solve-sample"
                  onClick={() => pickChapter(modelChapter)}
                >
                  改按模型说的第 {modelChapter} 章看
                </button>
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
                {model.answer.meta.diagram && !beyondWhitelist(questionText) ? (
                  <AnswerDiagram spec={model.answer.meta.diagram} scheme={diagramScheme} />
                ) : asksDiagram(questionText) ? (
                  <p className="solve-note">
                    这道题要求画「{askedSubject(questionText)}」的图，当前只支持 2ASK / 2PSK / 2FSK
                    的时间波形，画不了{chapter > 0 ? `，可去第 ${chapter} 章看` : ''}。
                  </p>
                ) : (
                  <p className="solve-note">这道题不需要画图。</p>
                )}
              </>
            ) : null}
            {model.kind === 'pending' ? (
              <>
                <p className="solve-progress">
                  {phase || '正在准备'} · 已用时 {seconds(waited)}
                </p>
                {/* R135：等待一律用骨架呼吸条，不转圈。 */}
                <div className="skeleton-block" aria-hidden="true">
                  <span className="skeleton-bar wide" />
                  <span className="skeleton-bar mid" />
                  <span className="skeleton-bar short" />
                </div>
              </>
            ) : null}
            {model.kind === 'error' ? (
              <>
                <p className="solve-locate solve-error">
                  模型这次没答上来（
                  {model.errorKind === 'timeout'
                    ? '超时'
                    : model.errorKind === 'http'
                      ? '端点报错'
                      : model.errorKind === 'parse'
                        ? '回复解析失败'
                        : '失败'}
                  ）：{model.message}
                </p>
                <p className="solve-note">没有回退成演示答案。{MODEL_ERROR_TAIL}</p>
                <div className="solve-error-actions">
                  <button type="button" className="solve-sample" onClick={retryModel}>
                    重试这一张图
                  </button>
                  <button type="button" className="solve-sample" onClick={() => setShowConfig(true)}>
                    检查端点配置
                  </button>
                </div>
              </>
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
              <>
                <p className="solve-note">等答案回来。</p>
                <div className="skeleton-block" aria-hidden="true">
                  <span className="skeleton-bar wide" />
                  <span className="skeleton-bar mid" />
                </div>
              </>
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
              style={frameHeight > 0 ? { height: `${frameHeight}px` } : undefined}
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