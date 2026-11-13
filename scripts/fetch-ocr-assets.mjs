/**
 * 把 OCR 需要的一次性资源从 node_modules 复制进 public/，并记下来源与 sha256。
 *
 * 只在开发期跑一次（npm run ocr:assets），产物随仓库提交；运行时不下载任何东西。
 * 数据来源是 npm 包，不依赖外网 CDN：
 * - tesseract.js@6.0.1 的 worker.min.js
 * - tesseract.js-core 的 lstm 核心（simd + 非 simd 两套，浏览器自己挑）
 * - @tesseract.js-data/chi_sim@1.0.0 的 4.0.0_best_int（tessdata_fast 的 chi_sim 整数版）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '..')
const MANIFEST = path.join(ROOT, 'scripts', 'ocr-assets.json')

const COPIES = [
  {
    from: 'node_modules/tesseract.js/dist/worker.min.js',
    to: 'public/tesseract/worker.min.js',
    source: 'tesseract.js@6.0.1 · dist/worker.min.js',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
    to: 'public/tesseract/tesseract-core-simd-lstm.wasm',
    source: 'tesseract.js-core@6 · tesseract-core-simd-lstm.wasm',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    to: 'public/tesseract/tesseract-core-simd-lstm.wasm.js',
    source: 'tesseract.js-core@6 · tesseract-core-simd-lstm.wasm.js',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
    to: 'public/tesseract/tesseract-core-lstm.wasm',
    source: 'tesseract.js-core@6 · tesseract-core-lstm.wasm',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
    to: 'public/tesseract/tesseract-core-lstm.wasm.js',
    source: 'tesseract.js-core@6 · tesseract-core-lstm.wasm.js',
  },
  {
    from: 'node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz',
    to: 'public/tessdata/chi_sim.traineddata.gz',
    source: '@tesseract.js-data/chi_sim@1.0.0 · 4.0.0_best_int（tessdata_fast 的 chi_sim 整数版）',
  },
]

fs.mkdirSync(MANIFEST.replace(/[^\\/]+$/, ''), { recursive: true })
const records = []
for (const item of COPIES) {
  const from = path.join(ROOT, item.from)
  const to = path.join(ROOT, item.to)
  if (!fs.existsSync(from)) {
    console.error(`缺少 ${item.from}：先 npm i 再跑本脚本`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const bytes = fs.readFileSync(from)
  fs.writeFileSync(to, bytes)
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  records.push({ target: item.to, source: item.source, bytes: bytes.length, sha256 })
  console.log(`${item.to}  ${bytes.length} B  sha256=${sha256.slice(0, 16)}…`)
}

fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), assets: records }, null, 2) + '\n')
console.log(`已写 ${path.relative(ROOT, MANIFEST)}（${records.length} 项）`)
