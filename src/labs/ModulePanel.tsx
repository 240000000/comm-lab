// 扩展模式右侧「功能模块」面板（R136 第二步：每章一行、两档并排）。
//
// 行轴是章：13 章各一行，行内两个档位按钮并排，26 个可点入口仍然一个不少，
// 但不再出现同一个功能名连着写两遍（R135 那一版正是这样，看上去像渲染错位）。
// 三色圆点按章聚合：任一档有正文依据就是绿点，只有标题依据是黄点，
// 两档都没涉及才是灰点；依据（命中的词与页码）仍在圆点的 title 里。
// 面板标题下那句「26 个入口里 N 个有正文依据」保留。
import type { ShelfBook } from '../course/shelf.ts'
import { coverageOf } from '../course/shelf.ts'
import { COURSE_PRESETS } from '../course/presets.ts'

const DOT_LABEL = { body: '正文命中', title: '仅标题', none: '未涉及' } as const

export function ModulePanel({ book }: { book: ShelfBook | null }) {
  const coverage = coverageOf(book)
  const hasBody = coverage.fromBody > 0
  const summary = hasBody
    ? `这本书读到正文：26 个入口里 ${coverage.fromBody} 个有正文依据（绿点）。`
    : '这本书目前只读到目录：功能按章名匹配（黄点），读到正文后会变绿点并给出命中的词与页码。'

  const chapters = COURSE_PRESETS
  const numbers = Object.keys(chapters)
    .map((key) => Number(key))
    .sort((a, b) => a - b)

  return (
    <section className="module-panel" aria-label="功能模块">
      <header className="module-head">
        <h2 className="module-title">功能模块</h2>
        <p className="module-sub">{book ? book.title : '还没导入教材'}</p>
        <p className="module-summary">{summary}</p>
      </header>
      <ol className="module-list">
        {numbers.map((no) => {
          const tiers = chapters[no]
          const rowA = coverage.rows.find((row) => row.no === no && row.preset === 'a')
          const rowB = coverage.rows.find((row) => row.no === no && row.preset === 'b')
          const first = rowA ?? rowB
          if (!first) return null
          const basis =
            rowA?.basis === 'body' || rowB?.basis === 'body'
              ? 'body'
              : rowA?.basis === 'title' || rowB?.basis === 'title'
                ? 'title'
                : 'none'
          const off = !rowA?.chapter && !rowB?.chapter
          const name = first.name
          const chapterTitle = rowA?.chapter?.rawTitle ?? rowB?.chapter?.rawTitle ?? ''
          const detail = [rowA?.title, rowB?.title].filter(Boolean).join(' ／ ')

          return (
            <li key={no} className={off ? 'module-row off' : 'module-row'}>
              <span className="module-no">{String(no).padStart(2, '0')}</span>
              <span
                className={`module-dot ${basis}`}
                title={`${DOT_LABEL[basis]}${chapterTitle ? ` · 第 ${no} 章「${chapterTitle}」` : ''}${detail ? ` · ${detail}` : ''}`}
              />
              <span className="module-name">{name}</span>
              <span className="module-presets">
                {tiers.map((tier) => {
                  const row = tier.id === 'a' ? rowA : rowB
                  return (
                    <a
                      key={tier.id}
                      className={row?.basis === 'body' ? 'course-preset is-active' : 'course-preset'}
                      href={`#/course?no=${no}&preset=${tier.id}`}
                      aria-pressed={row?.basis === 'body'}
                      title={`${tier.label} · ${DOT_LABEL[row?.basis ?? 'none']}`}
                    >
                      <span className="course-preset-id">{tier.id}</span>
                      {tier.label}
                    </a>
                  )
                })}
              </span>
              <span className={`module-badge ${basis}`}>{DOT_LABEL[basis]}</span>
            </li>
          )
        })}
      </ol>
      <p className="module-foot">
        26 个档位（13 章 × 2 档）：本书对上 {coverage.covered} 个（正文 {coverage.fromBody} 个、仅标题{' '}
        {coverage.fromTitle} 个）
        {coverage.missing > 0 ? `、未涉及 ${coverage.missing} 个` : ''}。
      </p>
    </section>
  )
}
