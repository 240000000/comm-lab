/**
 * 任务模式页面。
 *
 * 五道题不是题库，是拿前三个实验台当判据：每一题的答案都能在那边亲手做出来。
 * 期望值全部来自 src/core/missions.ts 的仿真函数，判分在本地完成。
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

export function MissionPage() {
  const [answers, setAnswers] = useState<Record<string, MissionAnswer | null>>({})
  const [grades, setGrades] = useState<MissionGrade[] | null>(null)

  const score = useMemo(() => (grades ? scoreMissions(grades) : null), [grades])

  const setAnswer = (id: string, value: MissionAnswer | null) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const gradeById = useMemo(() => {
    const map = new Map<string, MissionGrade>()
    for (const grade of grades ?? []) map.set(grade.id, grade)
    return map
  }, [grades])

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
          再回来填。判分在本地算，不联网、不调模型。
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
            测试里断言页面判分用的数与仿真算出来的数一致，代码一改两边一起变。
          </p>
        </article>
        <article className="note-card">
          <h2>判分在本地</h2>
          <p>
            没有后端、没有接口、没有模型调用。五道题的期望值随页面一起打包，判分就是几个比较。
          </p>
        </article>
      </section>
    </main>
  )
}
