// 扩展模式右侧「功能模块」面板（R135 重做信息密度）。
//
// 行轴是功能轴：13 章 × 两档档位 = 26 个入口，表格行数不随书变，
// 变的只有每一行对这本书的证据：正文命中、仅标题、还是根本没涉及。
//
// R135 改法：把原来每行都重复一遍的「仅按标题，未读正文：→ 第 N 章」收成
// 面板标题下的一句总说明，行内只留功能名、章号、状态圆点。
// 26 行按章分组：一章两档紧挨着，第一行带章号，两行共用一条左侧导轨，
// 行高压到 44px，1440×900 一屏能看到 16 行以上——密度是为了让人一眼扫完，
// 不是为了把信息删掉：依据（命中的词与页码）还在，挪进圆点的 title 里，
// 鼠标停上去就能读到，行内不再重复。
import type { ShelfBook } from '../course/shelf.ts'
import { coverageOf } from '../course/shelf.ts'

const DOT_LABEL = {
  body: '正文命中',
  title: '仅标题',
  none: '未涉及',
} as const

function courseHref(no: number, preset: string): string {
  return `#/course?no=${no}&preset=${preset}`
}

export function ModulePanel({ book }: { book: ShelfBook | null }) {
  const coverage = coverageOf(book)
  const rows = coverage.rows
  const hasBody = coverage.fromBody > 0

  // 只读到目录时给黄点说明，读到正文后改成「N 个有正文依据（绿点）」。
  const summary = hasBody
    ? `这本书读到正文：${rows.length} 个入口里 ${coverage.fromBody} 个有正文依据（绿点）`
    : '这本书目前只读到目录：功能按章名匹配（黄点），读到正文后会变绿点并给出命中的词与页码'

  return (
    <section className="module-panel">
      <header className="module-head">
        <h2 className="module-title">功能模块</h2>
        <p className="module-sub">{book ? book.title : '还没导入教材'}</p>
        <p className="module-summary">{summary}</p>
      </header>

      <ol className="module-list">
        {rows.map((row, index) => {
          const off = row.chapter === null
          const groupStart = index === 0 || rows[index - 1].no !== row.no
          const title = off
            ? `${DOT_LABEL[row.basis]}：这本书没有第 ${row.no} 章`
            : [`第 ${row.no} 章「${row.chapter?.rawTitle ?? ''}」`, DOT_LABEL[row.basis], row.title]
                .filter(Boolean)
                .join(' · ')
          return (
            <li
              key={`${row.no}-${row.preset}`}
              className={`module-row${off ? ' off' : ''}${groupStart ? ' group-start' : ''}`}
              title={title}
              onClick={() => {
                window.location.hash = courseHref(row.no, row.preset)
              }}
            >
              <span className="module-no">{groupStart ? String(row.no).padStart(2, '0') : ''}</span>
              <span className={`module-dot ${row.basis}`} aria-hidden="true" />
              <span className="module-name">{row.name}</span>
              <span className="module-tier">{row.label}</span>
              <span className="module-badge">{DOT_LABEL[row.basis]}</span>
            </li>
          )
        })}
      </ol>

      <p className="module-foot">
        26 个档位（13 章 × 2 档）：本书对上 {coverage.covered} 个（正文 {coverage.fromBody} 个、仅标题{' '}
        {coverage.covered - coverage.fromBody} 个）、未涉及 {coverage.missing} 个。
        {coverage.unknown > 0 ? ` 本书另有 ${coverage.unknown} 章未识别。` : ''}
      </p>
    </section>
  )
}