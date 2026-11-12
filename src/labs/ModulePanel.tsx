/**
 * 扩展模式的功能模块：13 条固定功能，一行一条，对着这本书看覆盖了哪些。
 *
 * 行轴是功能的，不是章的。理由写在这个文件外面：书可以换，功能清单不换，
 * 换一本只认得出两章的书，行数还是 13 行，变的是右列——覆盖的少了，一眼看出来。
 *
 * 只吃 props（一本书），自己不持状态。右列有覆盖时印书里那一章的原字标题，
 * 没覆盖就写「本书未涉及」，不做「大概是第几章」的猜测：猜错比不认更糟。
 *
 * 13 行都能点：接得住功能的那几行跳 `#/course?no=N`，没接住的也跳同一个地址，
 * 进的是默认示例——但这行灰着、鼠标停上去会说清楚，不假装它是这本书的内容。
 */
import { coverageOf, type ShelfBook } from '../course/shelf.ts'

type ModulePanelProps = {
  book: ShelfBook
}

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
            return (
              <tr
                key={row.no}
                className={chapter === null ? 'module-row off' : 'module-row'}
                onClick={() => {
                  window.location.hash = href
                }}
              >
                <td className="module-name">{row.name}</td>
                <td className="module-state" title={row.title}>
                  {state}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="module-foot">
              13 个功能：本书覆盖 {coverage.covered} 个、未涉及 {coverage.missing} 个。
              {coverage.unknown > 0 ? `本书另有 ${coverage.unknown} 章未识别。` : ''}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
