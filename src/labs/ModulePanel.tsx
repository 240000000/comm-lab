/**
 * 扩展模式的功能模块：当前这本书的章，一行一章，四列对着看。
 *
 * 只吃 props（一本书），自己不持状态。第二列故意用 rawTitle——书上怎么写的就怎么显示，
 * 让人一眼看出目录解析对不对，而不是拿我们改过的全称糊过去。
 *
 * 可玩的章整行链到 #/course?no=N；认不出来的章灰着，明说「暂无仿真」，
 * 不为了好看硬塞一个只能看的假模型。
 */
import { billOf, evidenceOf, isPlayable, type ShelfBook } from '../course/shelf.ts'

type ModulePanelProps = {
  book: ShelfBook
}

export function ModulePanel({ book }: ModulePanelProps) {
  const bill = billOf(book)

  return (
    <section className="module-panel" aria-label="功能模块">
      <header className="module-head">
        <h2 className="module-title">功能模块</h2>
        <p className="module-sub">{book.title}</p>
      </header>

      <table className="module-table">
        <thead>
          <tr>
            <th scope="col">章</th>
            <th scope="col">书上原字标题</th>
            <th scope="col">命中词</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {book.chapters.map((chapter, index) => {
            const playable = isPlayable(chapter)
            const no = chapter.no ?? index + 1
            const href = playable ? `#/course?no=${chapter.topicId}` : undefined
            return (
              <tr
                key={`${no}-${index}`}
                className={playable ? 'module-row' : 'module-row off'}
                onClick={
                  href
                    ? () => {
                        window.location.hash = href
                      }
                    : undefined
                }
              >
                <td className="module-no">{no}</td>
                <td className="module-raw">{chapter.rawTitle}</td>
                <td className="module-evidence">{evidenceOf(chapter)}</td>
                <td className="module-state">
                  {href ? <a href={href}>可交互</a> : '暂无仿真'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="module-foot">
              共 {bill.total} 章：{bill.playable} 章有仿真、{bill.uncovered} 章暂无仿真。
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

