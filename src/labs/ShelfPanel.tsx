/**
 * 扩展模式的书架：一本一行，能切、能删、能选文件导入。
 *
 * 只吃 props，自己不持状态——书架的真身是 src/course/shelfStore.ts，
 * 这里只负责把快照摆出来、把动作叫回去，将来课程视图想复用这一块不用改。
 *
 * 四个数（总章 / 可玩 / 未覆盖）全部由 billOf 现算，不写死：书的章数会随导入变。
 */
import { useRef } from 'react'
import type { ChangeEvent } from 'react'

import { DEFAULT_BOOK_ID, billOf, type ShelfBook } from '../course/shelf.ts'
import type { BookImportState } from './bookImport.ts'

type ShelfPanelProps = {
  books: ShelfBook[]
  activeId: string
  importState: BookImportState
  onPick: (id: string) => void
  onRemove: (id: string) => void
  onImport: (file: File) => void
}

export function ShelfPanel({ books, activeId, importState, onPick, onRemove, onImport }: ShelfPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 清空 value：同一个文件改完再选一次，也要能再触发 change。
    event.target.value = ''
    if (file) onImport(file)
  }

  return (
    <section className="shelf-panel" aria-label="书架">
      <header className="shelf-head">
        <h2 className="shelf-title">书架</h2>
        <label className="shelf-import">
          <input
            ref={inputRef}
            className="shelf-file"
            type="file"
            accept="application/pdf"
            onChange={pickFile}
          />
          导入 PDF 教材
        </label>
      </header>

      <ul className="shelf-list">
        {books.map((book) => {
          const bill = billOf(book)
          const active = book.id === activeId
          const isDefault = book.id === DEFAULT_BOOK_ID
          return (
            <li key={book.id} className={active ? 'shelf-row on' : 'shelf-row'}>
              <button
                type="button"
                className="shelf-pick"
                aria-current={active ? 'true' : undefined}
                onClick={() => onPick(book.id)}
              >
                <span className="shelf-book">{book.title}</span>
                <span className="shelf-counts">
                  {bill.total} 章 · 可玩 {bill.playable} · 未覆盖 {bill.uncovered}
                </span>
              </button>
              {isDefault ? (
                <span className="shelf-default">默认</span>
              ) : (
                <button
                  type="button"
                  className="shelf-drop"
                  aria-label={`把《${book.title}》从书架移除`}
                  onClick={() => onRemove(book.id)}
                >
                  移除
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {importState.status === 'parsing' ? (
        <p className="shelf-note" role="status">
          正在读《{importState.fileName}》的目录…
        </p>
      ) : null}
      {importState.status === 'failed' ? (
        <p className="shelf-note bad" role="alert">
          {importState.message}
        </p>
      ) : null}

      <p className="shelf-memory">书架在内存里：刷新页面回默认那本，导入的书不进缓存也不上传。</p>
    </section>
  )
}
