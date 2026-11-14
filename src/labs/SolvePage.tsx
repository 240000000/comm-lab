import { useEffect, useRef, useState } from 'react'
import './solve-page.css'
import { recognizeImage } from '../course/ocrImage.ts'
import { ANSWER_BANK, chapterTitle, problemByChapter, type BankProblem } from '../answer/bank.ts'
import { locateProblem, type LocateOutcome } from '../answer/locate.ts'
import { defaultProvider, hasModelEndpoint, type AnswerResult } from '../answer/provider.ts'

type Stage = 'idle' | 'reading' | 'ready' | 'error'

const IDLE_NOTE = '上传一张题目截图，或者直接点下面的内置样本——三题都能离线演示。'

/**
 * 右栏 iframe 的地址。
 *
 * 章节号走 CoursePage 已经支持的 `?no=`：课程视图只读自己的 hash 查询串，
 * 所以这里不新增路由参数，也不改课程视图。
 */
function courseUrl(chapter: number): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/course${chapter > 0 ? `?no=${chapter}` : ''}`
}

/**
 * 答题模式：左栏题目与答案，右栏嵌课程视图。
 *
 * 识别在浏览器里跑（tesseract），定位只做词面匹配（concepts.ts），
 * 答案来自内置题库；没配模型端点时明确标「演示模式」，不假装是模型答的。
 */
export default function SolvePage() {
  const [stage, setStage] = useState<Stage>('idle')
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [located, setLocated] = useState<LocateOutcome | null>(null)
  const [problem, setProblem] = useState<BankProblem | null>(null)
  // 模型答案按题号绑定：换题时旧答案自然失效，不用在 effect 里同步清空。
  const [modelAnswer, setModelAnswer] = useState<{ id: string; reply: AnswerResult } | null>(null)
  const [note, setNote] = useState(IDLE_NOTE)
  const objectUrl = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    }
  }, [])

  useEffect(() => {
    if (!problem) return
    const id = problem.id
    let alive = true
    defaultProvider({ text: problem.prompt, topicId: problem.chapter })
      .then((reply) => {
        if (!alive || 'status' in reply) return
        setModelAnswer({ id, reply })
      })
      .catch(() => {
        // 端点挂了就退回内置题答案，页面不冒出未处理异常。
      })
    return () => {
      alive = false
    }
  }, [problem])

  /** 识别一张图：先出预览，再走 ocr.ts 的 worker，最后定位章节。 */
  const readImage = async (blob: Blob, label: string) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(blob)
    setPreview(objectUrl.current)
    setStage('reading')
    setNote(`正在识别 ${label}…（首次要加载中文语言包，稍等一下）`)
    setLocated(null)
    setProblem(null)
    setText('')

    const outcome = await recognizeImage(blob)
    if (!outcome.ok) {
      setStage('error')
      setNote(outcome.message)
      return
    }
    setText(outcome.text)
    const result = locateProblem(outcome.text)
    setLocated(result)
    setStage('ready')
    if (!result) {
      setNote('识别完成，但没看出属于哪一章——可以换一张图，或直接选下面的内置题。')
      return
    }
    setProblem(result.ambiguous ? null : (problemByChapter(result.chapter) ?? null))
    setNote(`识别完成（${(outcome.ms / 1000).toFixed(1)} s）。`)
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void readImage(file, file.name)
  }

  /** 内置样本：演示时不依赖用户自己截图，按钮直接把样本当上传文件。 */
  const loadSample = async (item: BankProblem) => {
    setNote(`正在取样本 ${item.title}…`)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${item.sample}`)
      if (!response.ok) throw new Error(`${response.status}`)
      void readImage(await response.blob(), item.title)
    } catch (error) {
      setStage('error')
      setNote(`样本加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 定位模糊时用户手选一章：用该章的内置题，没有就只开右栏。 */
  const pickChapter = (chapter: number) => {
    setProblem(problemByChapter(chapter) ?? null)
    setLocated((prev) => (prev ? { ...prev, chapter, ambiguous: false } : prev))
  }

  const chapter = located?.chapter ?? 0
  const model = modelAnswer && problem && modelAnswer.id === problem.id ? modelAnswer.reply : null
  const answer = model ?? problem?.answer ?? null
  const fromModel = model !== null && hasModelEndpoint()

  return (
    <div className="solve-page">
      <header className="solve-head">
        <div>
          <h1>答题模式</h1>
          <p className="solve-sub">
            上传题目截图 → 本机识别 → 定位到对应章节并在右侧打开实验台。识别与定位都在浏览器里跑，不上传任何图片。
          </p>
        </div>
        <a className="solve-back" href="#/">
          ← 回到首页
        </a>
      </header>

      <div className="solve-grid">
        <section className="solve-left" aria-label="题目与答案">
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
                  {item.title}
                </button>
              ))}
            </div>
            {preview ? <img className="solve-preview" src={preview} alt="上传的题目截图" /> : null}
            <p className="solve-note">{note}</p>
          </article>

          <article className="solve-card">
            <h2>2 · 识别出的题面</h2>
            {text ? (
              <pre className="solve-text">{text}</pre>
            ) : (
              <p className="solve-hint">
                {stage === 'reading' ? '正在识别…' : '还没有识别结果。识别只认字面，图片别太糊、别斜着拍。'}
              </p>
            )}
            {located ? (
              <p className="solve-locate">
                已定位到第 {located.chapter} 章 · {chapterTitle(located.chapter)} · 命中词：
                {located.hits.length > 0 ? located.hits.join('、') : '（没有明显命中）'}
              </p>
            ) : null}
            {located?.ambiguous ? (
              <div className="solve-top3">
                这一题不太像某一章独占的表述，可能是下面几章之一，点一个自己确认：
                <div className="solve-top3-list">
                  {located.top.map((item) => {
                    const no = Number(item.topicId.replace('ch', ''))
                    return (
                      <button
                        key={item.topicId}
                        type="button"
                        className="solve-sample"
                        onClick={() => pickChapter(no)}
                      >
                        第 {no} 章 · {chapterTitle(no)}（{item.score}）
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </article>

          <article className="solve-card">
            <h2>3 · 答案</h2>
            {answer ? (
              <>
                <span className={`solve-badge ${fromModel ? 'ok' : 'demo'}`}>
                  {fromModel ? '模型作答' : '演示模式：未接模型，下面是从内置题库取的答案'}
                </span>
                <p className="solve-headline">{answer.headline}</p>
                <ul className="solve-params">
                  {answer.params.map((item) => (
                    <li key={item.key}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </li>
                  ))}
                </ul>
                {answer.caveat ? <p className="solve-caveat">{answer.caveat}</p> : null}
              </>
            ) : (
              <p className="solve-hint">还没定位到题。识别完成、且落在内置题库的三章之一时，这里会给出答案。</p>
            )}
          </article>

          <article className="solve-card">
            <h2>4 · 关键步骤</h2>
            {answer ? (
              <ol className="solve-steps">
                {answer.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="solve-hint">答案确定后，这里给出推导的关键几步。</p>
            )}
          </article>
        </section>

        <aside className="solve-right" aria-label="交互区">
          <div className="solve-frame-head">
            <h2>{chapter > 0 ? `第 ${chapter} 章 · ${chapterTitle(chapter)}` : '交互区'}</h2>
            <span className="solve-hint">
              {chapter > 0 ? '右侧已打开对应章节的实验台，可以接着动手调参数。' : '定位到某一章后，这里会自动打开那一章。'}
            </span>
          </div>
          {chapter > 0 ? (
            <iframe
              className="solve-frame"
              title={`第 ${chapter} 章课程视图`}
              src={courseUrl(chapter)}
            />
          ) : (
            <div className="solve-frame-empty">还没定位到章节，先上传一张截图。</div>
          )}
        </aside>
      </div>
    </div>
  )
}