/**
 * 扩展模式的功能模块：13 条固定功能，一行一条，对着这本书看覆盖了哪些。
 *
 * 行轴是功能的，不是章的。理由写在这个文件外面：书可以换，功能清单不换，
 * 换一本只认得出两章的书，行数还是 13 行，变的是右列——覆盖的少了，一眼看出来。
 *
 * R126 起判定先读正文：右列不再是「哪个章名像」，而是「正文里哪些词出现了几次、
 * 在第几页」。标题只在正文不够时兜底，并且必须自己说出来——写「仅按标题，未读正文」，
 * 不能让人以为这行是读过正文才认的。
 *
 * 没接住的行给一个「直接看第 N 章的仿真」按钮：它进的是默认示例，不是这本书的内容，
 * 所以按钮上写明是仿真，行本身仍然灰着。
 */
import { coverageOf, type ShelfBook } from '../course/shelf.ts'

type ModulePanelProps = {
  book: ShelfBook
}

const BASIS_TAG = {
  body: '正文命中',
  title: '仅标题',
  none: '未涉及',
} as const

export function ModulePanel({ book }: ModulePanelProps) {
  const coverage = coverageOf(book)

  return (
    <section className="module-panel" aria-label="功能模块">
      <header className="module-head">
        <h2 className="module-title">功能模块</h2>
        <p className="module-sub">{book.title}</p>
      </header>

      <table className="module-table">
        <thead>
          <tr>
            <th scope="col">功能</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {coverage.rows.map((row) => {
            const href = `#/course?no=${row.no}`
            const chapter = row.chapter
            const state =
              chapter === null
                ? '本书未涉及'
                : chapter.no === null
                  ? `本书「${chapter.rawTitle}」`
                  : `本书第 ${chapter.no} 章「${chapter.rawTitle}」`
            const detail = row.basis === 'none' ? '正文里没认到这几个概念词，章名也对不上。' : row.title
            return (
              <tr
                key={row.no}
                className={chapter === null ? 'module-row off' : 'module-row'}
                onClick={() => {
                  window.location.hash = href
                }}
              >
                <td className="module-name">{row.name}</td>
                <td className="module-state" title={detail}>
                  <span className={`module-tag ${row.basis}`}>{BASIS_TAG[row.basis]}</span>
                  <span className="module-where">{state}</span>
                  <span className="module-basis">{detail}</span>
                  {chapter === null ? (
                    <button
                      type="button"
                      className="module-go"
                      onClick={(event) => {
                        event.stopPropagation()
                        window.location.hash = href
                      }}
                    >
                      直接看第 {row.no} 章的仿真
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="module-foot">
              13 个功能：本书覆盖 {coverage.covered} 个（正文 {coverage.fromBody} 个、仅标题{' '}
              {coverage.fromTitle} 个）、未涉及 {coverage.missing} 个。
              {coverage.unknown > 0 ? `本书另有 ${coverage.unknown} 章未识别。` : ''}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}