/**
 * 书架面板：一行一本，状态写清楚「目录存了没、原文件存了没」。
 *
 * 这一层只吃 props、不自己持状态：读盘、落盘、导入都在 shelfStore / shelfDb 里，
 * 面板负责的是把它看见的东西照实说——包括失败那一行原话。
 */
import type { ChangeEvent } from 'react'

import { DEFAULT_BOOK_ID, billOf, type ShelfBook } from '../course/shelf.ts'
import { shelfStatusOf } from '../course/shelfStore.ts'
import type { BookImportState } from './bookImport.ts'

type ShelfPanelProps = {
  books: ShelfBook[]
  activeId: string
  importState: BookImportState
  ready: boolean
  storedIds: string[]
  pdfBytes: Record<string, number>
  keepPdf: boolean
  savingName: string | null
  persistNote: string | null
  onPick: (id: string) => void
  onRemove: (id: string) => void
  onImport: (file: File) => void
  onToggleKeepPdf: (next: boolean) => void
}

export function ShelfPanel({
  books,
  activeId,
  importState,
  ready,
  storedIds,
  pdfBytes,
  keepPdf,
  savingName,
  persistNote,
  onPick,
  onRemove,
  onImport,
  onToggleKeepPdf,
}: ShelfPanelProps) {
  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onImport(file)
  }

  return (
    <section className="shelf-panel" aria-label="书架">
      <header className="shelf-head">
        <h2 className="shelf-title">书架</h2>
        <label className="shelf-import">
          <input className="shelf-file" type="file" accept="application/pdf" onChange={pickFile} />
          导入 PDF 教材
        </label>
      </header>

      <label className="shelf-toggle">
        <input
          type="checkbox"
          checked={keepPdf}
          onChange={(event) => onToggleKeepPdf(event.target.checked)}
        />
        导入时同时保存原文件
      </label>

      <ul className="shelf-list">
        {books.map((book) => {
          const bill = billOf(book)
          const active = book.id === activeId
          const status = shelfStatusOf(book.id, { ready, storedIds, pdfBytes })
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
                <span className="shelf-status">{status}</span>
              </button>
              {book.id === DEFAULT_BOOK_ID ? (
                <span className="shelf-default">默认</span>
              ) : (
                <button
                  type="button"
                  className="shelf-drop"
                  aria-label={`把《${book.title}》从书架移除，并删掉本机副本`}
                  onClick={() => onRemove(book.id)}
                >
                  删除本机副本
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {savingName ? (
        <p className="shelf-note" role="status">
          正在保存原文件…（{savingName}）
        </p>
      ) : null}
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
      {persistNote ? (
        <p className="shelf-note bad" role="status">
          {persistNote}
        </p>
      ) : null}

      <p className="shelf-memory">
        书架存在这台机器的浏览器里（IndexedDB）：目录随时读，原文件按上面的开关决定存不存；都不上传。
      </p>
    </section>
  )
}
