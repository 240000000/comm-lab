/**
 * 首页书架用的「选一个 PDF → 认出一本书」。
 *
 * 流程与课程视图里那段一致：只读书签树与前几页文字层，认出来的章交给 bookFromOutline。
 * 解析层整套懒加载——pdfjs 与关键词表只有真的选了文件才进客户端。
 *
 * 失败只说人话，不谈实现：三种情况各有各的说法，不合并成「导入失败」。
 */
import { bookFromOutline, type ShelfBook } from '../course/shelf.ts'

export const MAX_PDF_BYTES = 250 * 1024 * 1024

export const NOT_PDF_MESSAGE = '这里只认 PDF，选一个 .pdf 文件试试。'
export const TOO_LARGE_MESSAGE = '这本超过 250 MB，请换一本'
export const NO_OUTLINE_MESSAGE = '这本没有可读的目录，也没有文字层，换个有书签的版本试试'
export const BROKEN_MESSAGE = '这本 PDF 打不开或已加密，换一本试试'

export type BookImportResult =
  | { ok: true; book: ShelfBook }
  | { ok: false; message: string }

export type BookImportState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string }
  | { status: 'failed'; fileName: string; message: string }

/** 读一个文件；成功就还给调用方一本可以进书架的书，失败只还一句人话。 */
export async function readBookFile(file: File, id: string): Promise<BookImportResult> {
  if (!/\.pdf$/i.test(file.name)) return { ok: false, message: NOT_PDF_MESSAGE }
  if (file.size > MAX_PDF_BYTES) return { ok: false, message: TOO_LARGE_MESSAGE }

  const outline = await import('../course/pdfOutline.ts')
  try {
    const entries = await outline.parsePdfOutline(await file.arrayBuffer())
    if (entries.length === 0) return { ok: false, message: NO_OUTLINE_MESSAGE }
    const title = file.name.replace(/\.pdf$/i, '')
    return { ok: true, book: bookFromOutline(title, outline.toBook(entries), id) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof outline.PdfOutlineError ? error.message : BROKEN_MESSAGE,
    }
  }
}
