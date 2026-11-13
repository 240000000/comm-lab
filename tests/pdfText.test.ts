import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { itemsToLines, readPdfText, splitSections } from '../src/course/pdfText.ts'
import { scoreSection, TOPICS } from '../src/course/concepts.ts'

/** 只读夹具：技术报告 PDF 在本机工作目录里，不进仓库；没有就跳过整条用例。 */
const FIXTURE = 'D:/harness/work/_report/tech-report.pdf'
const NO_FIXTURE = fs.existsSync(FIXTURE)
  ? false
  : '本机没有 D:/harness/work/_report/tech-report.pdf（只读夹具，不进仓库）'

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

test('itemsToLines：同一行按 x 拼、不同行按 y 从上到下', () => {
  const lines = itemsToLines([
    { str: 'B', transform: [1, 0, 0, 1, 20, 100] },
    { str: 'A', transform: [1, 0, 0, 1, 10, 100] },
    { str: 'C', transform: [1, 0, 0, 1, 10, 80] },
  ])
  assert.deepEqual(lines, ['AB', 'C'])
})

test('技术报告 PDF：文字层、切节与 13 个实验命中', { skip: NO_FIXTURE }, async () => {
  const bytes = new Uint8Array(fs.readFileSync(FIXTURE))
  const { text, destroy } = await readPdfText(bytes, () => import('pdfjs-dist/legacy/build/pdf.mjs'))
  try {
    assert.ok(text.hasTextLayer, 'PDF 没有文字层')
    assert.ok(text.totalChars > 30000, `总字符 ${text.totalChars}，不到 30000`)
    const sections = splitSections(text.pages)
    assert.ok(sections.length > 5, `只切出 ${sections.length} 节`)
    const haystack = normalize(text.pages.join('\n'))
    for (const topic of TOPICS) {
      const hit = topic.terms.find((term) => haystack.includes(normalize(term)))
      assert.ok(hit, `${topic.topicId} ${topic.title} 全文没有命中任何概念词`)
    }
    assert.equal(scoreSection(text.pages.join('\n')).length, 3, 'scoreSection 应返回前三名')
  } finally {
    await destroy()
  }
})
