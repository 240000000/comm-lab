/**
 * 逐章识别结果的缓存格式（R109）。
 *
 * 单独一个文件是为了让课程视图静态引它、却不必把整条 OCR 链（tesseract、
 * pdfjs）拉进主包——识别仍然按需 `import('./chapterOcr.ts')`。
 * 结果存在 ocr store 里：原件被清掉之后，结论卡的证据行还能说出页码。
 */
import type { ChapterScan } from './chapterOcr.ts'

export function scanCacheKey(bookId: string): string {
  return `scan:${bookId}`
}

/** 坏数据一律当作没有：缓存只用来省一次识别，不该让界面打不开。 */
export function parseScanCache(text: string | null): ChapterScan[] | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.length === 0) return null
    const complete = value.every((item) => {
      if (typeof item !== 'object' || item === null) return false
      const row = item as Record<string, unknown>
      return typeof row.chapterNo === 'number' && typeof row.page === 'number' && typeof row.chars === 'number'
    })
    return complete ? (value as ChapterScan[]) : null
  } catch {
    return null
  }
}