import type { OcrWorker } from './ocr.ts'
import { normalizeOcrText } from './normalize.ts'

/** 一张图片的识别结果；失败时给中文原因，不抛给调用方。 */
export type ImageOcrOutcome =
  | { ok: true; text: string; ms: number }
  | { ok: false; message: string }

/**
 * 识别单张图片（题目截图）。
 *
 * 复用 ocr.ts 的 worker 创建逻辑——同一套 workerPath / corePath / langPath，
 * 不另建配置：tesseract 的 recognize 本身就吃 Blob / ImageData，
 * 所以这里只是把「一页 PDF」换成「一张图」，其余完全一致。
 */
export async function recognizeImage(
  image: Blob,
  options: { worker?: OcrWorker; timeoutMs?: number } = {},
): Promise<ImageOcrOutcome> {
  const started = Date.now()
  // 动态引入：ocr.ts 在 CoursePage 里是懒加载的（tesseract 很重），
  // 这里静态引入会让那次懒加载失效，整包一起变大。
  const { createOcrWorker, OCR_TIMEOUT_MS } = await import('./ocr.ts')
  const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS
  const ownWorker = options.worker ? null : createOcrWorker()
  try {
    const worker = options.worker ?? (await ownWorker!)
    const text = await Promise.race([
      worker.recognize(image).then((result) => result.data.text),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('识别超时')), timeoutMs)
      }),
    ])
    // 逐字识别常把汉字用空格隔开，先按 normalizing 规则收拾再交给定位与展示。
    const cleaned = normalizeOcrText(text)
    if (cleaned === '') {
      return { ok: false, message: '图里没认出文字，换一张更清楚的截图再试' }
    }
    return { ok: true, text: cleaned, ms: Date.now() - started }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `识别失败：${message}` }
  } finally {
    if (ownWorker) await ownWorker.catch(() => null)
    if (options.worker) await options.worker.terminate()
  }
}