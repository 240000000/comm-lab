/**
 * 任务模式页面。
 *
 * 五道固定题不是题库，是拿前三个实验台当判据：每一题的答案都能在那边亲手做出来。
 * 期望值全部来自 src/core/missions.ts 的仿真函数，判分在本地完成。
 *
 * 下面再加一区「你自己出题」：阶数、信噪比、样本量由用户挑，标准答案由
 * src/core/customQuestion.ts 现算；答完可以存进浏览器本地，刷新还在。
 */
import { useMemo, useState } from 'react'
import {
  MISSIONS,
  gradeMissions,
  scoreMissions,
  type Mission,
  type MissionAnswer,
  type MissionGrade,
} from '../core/missions'
import {
  CUSTOM_DEFAULT_BITS,
  CUSTOM_MAX_BITS,
  CUSTOM_MAX_SNR_DB,
  CUSTOM_MIN_SNR_DB,
  createCustomQuestion,
  createSavedRecord,
  formatBer,
  gradeCustomAnswer,
  loadSavedQuestions,
  removeSavedQuestion,
  saveSavedQuestion,
  type CustomGrade,
  type CustomQuestion,
  type SavedQuestion,
  type StorageLike,
} from '../core/customQuestion'
import { QAM_ORDERS, orderLabel } from '../core/qam'

const KIND_LABEL: Record<Mission['kind'], string> = {
  numeric: '数值题',
  phenomenon: '现象题',
  ability: '能力题',
  concept: '概念题',
  selection: '选型题',
}

const REPRODUCE_LINK: Record<string, { href: string; label: string }> = {
  numeric: { href: '#/qam', label: '去 QAM 页复现' },
  phenomenon: { href: '#/ofdm', label: '去 OFDM 页复现' },
  ability: { href: '#/conv', label: '去卷积码页复现' },
  concept: { href: '#/ofdm', label: '去 OFDM 页看说明卡' },
  selection: { href: '#/qam', label: '去 QAM 页看曲线' },
}

const formatCount = (value: number) => value.toLocaleString('en-US')

/** 存档时间按本地时区显示；ISO 字符串原样塞进 dateTime 属性。 */
function formatSavedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** localStorage 在隐私模式下可能连读都抛错，这里统一兜住。 */
function getBrowserStorage(): StorageLike | null {
  try {
    const storage = window.localStorage
    const probe = '__comm_lab_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

type InitialSaved = { items: SavedQuestion[]; note: string | null }

/** 首次渲染时读一次本地存档；读不出来就给提示，不让页面崩。 */
function loadInitialSaved(): InitialSaved {
  const storage = getBrowserStorage()
  if (!storage) {
    return { items: [], note: '浏览器禁用了本地存储，这一区这次不能保存。' }
  }
  const loaded = loadSavedQuestions(storage)
  return { items: loaded.items, note: loaded.error }
}

export function MissionPage() {
  const [answers, setAnswers] = useState<Record<string, MissionAnswer | null>>({})
  const [grades, setGrades] = useState<MissionGrade[] | null>(null)

  const [draft, setDraft] = useState({
    order: 16,
    snrDb: '12',
    sampleBits: String(CUSTOM_DEFAULT_BITS),
  })
  const [customQuestion, setCustomQuestion] = useState<CustomQuestion | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const [customAnswer, setCustomAnswer] = useState('')
  const [customGrade, setCustomGrade] = useState<CustomGrade | null>(null)
  const [initialSaved] = useState<InitialSaved>(loadInitialSaved)
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[]>(initialSaved.items)
  const [storageNote, setStorageNote] = useState<string | null>(initialSaved.note)
  const [savedId, setSavedId] = useState<string | null>(null)

  const score = useMemo(() => (grades ? scoreMissions(grades) : null), [grades])

  const setAnswer = (id: string, value: MissionAnswer | null) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const gradeById = useMemo(() => {
    const map = new Map<string, MissionGrade>()
    for (const grade of grades ?? []) map.set(grade.id, grade)
    return map
  }, [grades])

  const setDraftField = (field: 'order' | 'snrDb' | 'sampleBits', value: string | number) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  const handleGenerate = () => {
    const snrDb = draft.snrDb.trim() === '' ? Number.NaN : Number(draft.snrDb)
    const sampleBits = draft.sampleBits.trim() === '' ? Number.NaN : Number(draft.sampleBits)
    const result = createCustomQuestion({ order: draft.order, snrDb, sampleBits })

    if (!result.ok) {
      // 校验没过就把上一道题清掉：不能让旧题面留着，让人以为这次生成成功了。
      setCustomError(result.message)
      setCustomQuestion(null)
      setCustomGrade(null)
      setCustomAnswer('')
      setSavedId(null)
      return
    }

    setCustomError(null)
    setCustomQuestion(result.question)
    setCustomGrade(null)
    setCustomAnswer('')
    setSavedId(null)
  }

  const handleGrade = () => {
    if (!customQuestion) return
    setCustomGrade(gradeCustomAnswer(customQuestion, customAnswer))
    setSavedId(null)
  }

  const handleSave = () => {
    if (!customQuestion || !customGrade || customGrade.parsed === null) return
    const storage = getBrowserStorage()
    if (!storage) {
      setStorageNote('浏览器禁用了本地存储，这道题没存上。')
      return
    }

    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const record = createSavedRecord(
      customQuestion,
      customGrade.parsed,
      customGrade.correct,
      new Date().toISOString(),
      id,
    )
    const result = saveSavedQuestion(storage, record)
    setSavedQuestions(result.items)
    setStorageNote(result.error)
    if (result.ok) setSavedId(id)
  }

  const handleDelete = (id: string) => {
    const storage = getBrowserStorage()
    if (!storage) {
      setStorageNote('浏览器禁用了本地存储，删不了。')
      return
    }
    const result = removeSavedQuestion(storage, id)
    setSavedQuestions(result.items)
    setStorageNote(result.error)
  }

  return (
    <main className="lab">
      <a className="back" href="#/">
        ← 返回首页
      </a>

      <header className="hero lab-hero">
        <p className="eyebrow">任务模式</p>
        <h1>五道题，答案都在前三页</h1>
        <p className="lede">
          这里没有题库。每道题的答案，都能在前三个实验台上亲手复现——你先在那边把参数摆出来、把数字读出来，
          再回来填。判分在本地算，不联网、不调模型。五道题之外，下面还能自己挑参数出题。
        </p>
      </header>

      <section className="mission-list" aria-label="五道任务">
        {MISSIONS.map((mission, index) => {
          const grade = gradeById.get(mission.id)
          const link = REPRODUCE_LINK[mission.id]
          const answer = answers[mission.id] ?? null

          return (
            <article className="mission-card" key={mission.id}>
              <header className="mission-head">
                <span className="mission-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="mission-kind">{KIND_LABEL[mission.kind]}</span>
                {grade && (
                  <span className={grade.correct ? 'mission-flag ok' : 'mission-flag bad'}>
                    {grade.correct ? '答对' : '答错'}
                  </span>
                )}
              </header>

              <p className="mission-q">{mission.question}</p>
              <p className="mission-evidence">
                {mission.evidence}
                {link && (
                  <a className="mission-link" href={link.href}>
                    {link.label}
                  </a>
                )}
              </p>

              {mission.options ? (
                <div className="segmented" role="group" aria-label={`第 ${index + 1} 题选项`}>
                  {mission.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={answer === option}
                      onClick={() => setAnswer(mission.id, option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  className="mission-input"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder={mission.id === 'numeric' ? '比如 2.9e-2' : '填一个整数'}
                  value={answer === null ? '' : String(answer)}
                  onChange={(event) => {
                    const raw = event.target.value
                    setAnswer(mission.id, raw === '' ? null : Number(raw))
                  }}
                  aria-label={`第 ${index + 1} 题作答`}
                />
              )}

              {grade && <p className={grade.correct ? 'mission-reason ok' : 'mission-reason bad'}>{grade.reason}</p>}
            </article>
          )
        })}
      </section>

      <section className="score-bar" aria-label="判分">
        <div>
          <p className="score-label">得分</p>
          <p className="score-value">
            {score ? `${score.correct} / ${score.total}` : '— / 5'}
          </p>
          <p className="score-note">
            {score
              ? score.allCorrect
                ? '五题全对：前三页里的参数你都能自己摆出来了。'
                : '还有没答对的：点题面里的链接回实验台，把参数摆一遍再回来。'
              : '填完点右边的「判分」。答错不扣分，可以重来。'}
          </p>
        </div>
        <button
          type="button"
          className="score-button"
          onClick={() => setGrades(gradeMissions(answers))}
        >
          判分
        </button>
      </section>

      <section className="custom-section" aria-label="自己出题">
        <header className="custom-head">
          <h2>你自己出题</h2>
          <p className="custom-lede">
            挑阶数、信噪比和样本量，点一下生成一道题。题目是你自己出的；标准答案由本地仿真现算；整个过程不联网，
            没有后端、没有账号。
          </p>
        </header>

        <div className="custom-controls">
          <div className="custom-field">
            <span>星座阶数</span>
            <div className="segmented" role="group" aria-label="自定义题阶数">
              {QAM_ORDERS.map((order) => (
                <button
                  key={order}
                  type="button"
                  aria-pressed={draft.order === order}
                  onClick={() => setDraftField('order', order)}
                >
                  {orderLabel(order)}
                </button>
              ))}
            </div>
          </div>

          <label className="custom-field">
            <span>信噪比 Es/N0（0–20 dB）</span>
            <input
              type="number"
              step="0.5"
              min={CUSTOM_MIN_SNR_DB}
              max={CUSTOM_MAX_SNR_DB}
              value={draft.snrDb}
              onChange={(event) => setDraftField('snrDb', event.target.value)}
            />
          </label>

          <label className="custom-field">
            <span>样本量（比特，最多 {formatCount(CUSTOM_MAX_BITS)}）</span>
            <input
              type="number"
              step="1"
              min="1"
              max={CUSTOM_MAX_BITS}
              value={draft.sampleBits}
              onChange={(event) => setDraftField('sampleBits', event.target.value)}
            />
          </label>

          <button type="button" className="custom-generate" onClick={handleGenerate}>
            生成一道题
          </button>
        </div>

        <p className="custom-hint">
          样本量按比特填，最小 1；样本太小时题目会退化——比如 1 个比特只有 0 和 1 两种答案，建议 20,000 比特以上。
        </p>

        {customError && (
          <p className="custom-error" role="alert">
            {customError}
          </p>
        )}

        {customQuestion && (
          <div className="custom-question">
            <p className="mission-q">
              {customQuestion.label}，Es/N0 = {customQuestion.snrDb} dB，样本量 {formatCount(customQuestion.sampleBits)} 比特。
              这组参数下的误码率是多少？
            </p>
            <p className="custom-tolerance">
              判分容差：真值大于 0 时，|你填的 − 仿真值| ≤ max(仿真值 × 10%, 1e-5)；真值等于 0 时须填 0。
            </p>

            <div className="custom-answer-row">
              <input
                className="mission-input"
                type="text"
                inputMode="decimal"
                placeholder="比如 2.9e-2"
                value={customAnswer}
                onChange={(event) => {
                  setCustomAnswer(event.target.value)
                  setCustomGrade(null)
                  setSavedId(null)
                }}
                aria-label="自定义题答案"
              />
              <button type="button" className="custom-grade" onClick={handleGrade}>
                判分
              </button>
            </div>

            {customGrade && customGrade.parsed !== null && (
              <>
                <p className={customGrade.correct ? 'mission-reason ok' : 'mission-reason bad'}>
                  {customGrade.reason}
                </p>
                <button
                  type="button"
                  className="custom-save"
                  onClick={handleSave}
                  disabled={savedId !== null}
                >
                  {savedId === null ? '保存这道题' : '已存到本地'}
                </button>
              </>
            )}
          </div>
        )}

        <div className="saved-block">
          <div className="saved-head">
            <h3>我存下的题</h3>
            <span>{savedQuestions.length === 0 ? '还没存过' : `共 ${savedQuestions.length} 道`}</span>
          </div>

          {storageNote && (
            <p className="custom-error" role="alert">
              {storageNote}
            </p>
          )}

          {savedQuestions.length > 0 && (
            <ul className="saved-list">
              {savedQuestions.map((item) => (
                <li className="saved-item" key={item.id}>
                  <div className="saved-line">
                    <span className="saved-params">
                      {orderLabel(item.order)} · {item.snrDb} dB · {formatCount(item.sampleBits)} 比特
                    </span>
                    <span className={item.correct ? 'mission-flag ok' : 'mission-flag bad'}>
                      {item.correct ? '答对' : '答错'}
                    </span>
                  </div>
                  <p className="saved-detail">
                    仿真答案 {formatBer(item.truth)}（错 {formatCount(item.bitErrors)} / 共 {formatCount(item.bitCount)} 比特）；
                    你填 {formatBer(item.given)}
                  </p>
                  <div className="saved-foot">
                    <time dateTime={item.savedAt}>{formatSavedAt(item.savedAt)}</time>
                    <button type="button" className="saved-delete" onClick={() => handleDelete(item.id)}>
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="notes" aria-label="这页怎么读">
        <article className="note-card">
          <h2>为什么是这五题</h2>
          <p>
            一道要你读一个数，一道要你看一个现象，一道要你判断译码器还剩多少错，一道考概念，一道考选型。
            五题覆盖三页实验台，答案都能当场复现，不是背出来的。
          </p>
        </article>
        <article className="note-card">
          <h2>期望值不是手抄的</h2>
          <p>
            数值题的答案由 <code>src/core/missions.ts</code> 里的仿真函数现算，容差 ±10%；
            测试里断言页面判分用的数与仿真算出来的数一致，代码一改两边一起变。自己出的题也一样，
            每点一次都重新跑仿真。
          </p>
        </article>
        <article className="note-card">
          <h2>判分在本地</h2>
          <p>
            没有后端、没有接口、没有模型调用。五道题的期望值随页面一起打包，判分就是几个比较；
            自己出的题在浏览器里现算，存下来的题放在浏览器本地，刷新还在。
          </p>
        </article>
      </section>
    </main>
  )
}
