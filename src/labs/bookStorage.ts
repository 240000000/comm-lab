/**
 * 原文件要不要存、能不能存、存不下时说什么。
 *
 * 规则写死在这里，界面只管把丢回来的那句话照抄：
 * - 可用空间不到文件大小的 `SPACE_MARGIN` 倍 → 只存目录，并说清原件多大没保存；
 * - 空间够 → 先申请持久化，再写 IndexedDB；
 * - 写失败（配额、中断、结构化克隆失败）→ 一律降级成只存目录，错误原文带出去。
 *
 * 默认那本是代码生成的，没有 PDF，别给它写 pdfs 记录。
 */
import { DEFAULT_BOOK_ID } from '../course/shelf.ts'
import { formatBytes } from '../course/shelfDb.ts'
import { storePdf } from '../course/shelfStore.ts'
import { readPdfMeta } from '../course/pdfSource.ts'

/** 可用空间不足文件的这个倍数，就只存目录。降级路径做实验时临时改成 0.0001。 */
export const SPACE_MARGIN = 1.2

export type SaveResult = { status: 'saved'; bytes: number } | { status: 'skipped'; message: string }

/** 人话的体积：146 MB、18 KB、512 B。 */
/**
 * 把这次导入的原文件存进本机书架。
 *
 * 失败不抛：返回一句能直接贴到面板上的原话，导入本身照旧可用。
 */
export async function saveOriginalPdf(file: File, id: string): Promise<SaveResult> {
  if (id === DEFAULT_BOOK_ID) {
    return { status: 'skipped', message: '默认那本是生成出来的，没有原文件可存。' }
  }
  const size = file.size

  let free = Number.POSITIVE_INFINITY
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate && typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
      free = estimate.quota - estimate.usage
    }
  } catch {
    // 读不到配额就当够用：真不够时写入会抛 QuotaExceededError，照样降级。
  }

  if (free < size * SPACE_MARGIN) {
    return {
      status: 'skipped',
      message: `本机空间不够，只存了目录（原文件 ${formatBytes(size)} 未保存）`,
    }
  }

  try {
    await navigator.storage?.persist?.()
  } catch {
    // 申请不上持久化也照存：最坏情况是浏览器在空间紧张时清掉它。
  }

  let meta = null
  try {
    meta = await readPdfMeta(file)
  } catch {
    // 解析不出首页就存 null：打开时跳过身份比对，但文件本身还能读。
  }

  const stored = await storePdf(id, file, meta)
  if (stored.ok) return { status: 'saved', bytes: size }
  return { status: 'skipped', message: `原文件没存下来（${stored.message}），只存了目录` }
}
