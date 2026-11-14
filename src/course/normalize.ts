/**
 * OCR 文本后处理：中文一个字一个字被识别时，tesseract 常把每个汉字用空格隔开，
 * 直接显示会把「带宽为 3 kHz」读成「带 宽 为 3 kHz」。这里按三条规则收拾：
 *   1. 汉字之间（含中文标点与汉字之间）的空白全部删掉；
 *   2. 汉字与拉丁字母/数字之间留一个空格，别粘成「带宽3 kHz」；
 *   3. 连续空白压成一个，空行合并，行首行尾不留空白。
 * 拉丁字母或数字内部的空格保留（`3 kHz`、`Eb/N0`、`S/N` 不能被粘起来）。
 */

/** 判断一个字符是否按「中文」处理：汉字、中文标点、全角符号。 */
function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

/** 拉丁字母与数字：和汉字相邻时要靠一个空格隔开。 */
function isLatin(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

/** 行内空白规整：汉字之间的空格删掉，其余空白压成一个，中英相邻补一个。 */
function normalizeLine(line: string): string {
  const chars = [...line.replace(/\s+/g, ' ').trim()]
  const out: string[] = []
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]
    if (ch !== ' ') {
      const prev = out[out.length - 1] ?? ''
      // 原文里「信噪比S/N」没有空格，这里主动补一个；中英两侧都判断，方向都管。
      if (prev && prev !== ' ' && ((isCjk(prev) && isLatin(ch)) || (isLatin(prev) && isCjk(ch)))) {
        out.push(' ')
      }
      out.push(ch)
      continue
    }
    const prev = out[out.length - 1] ?? ''
    const next = chars[i + 1] ?? ''
    // 只有两侧都是汉字（含中文标点）时空格才没有意义；中英之间留一个。
    if (!prev || !next) continue
    if (isCjk(prev) && isCjk(next)) continue
    out.push(' ')
  }
  return out.join('')
}

/** 把 OCR 出来的原文收拾成能直接展示、也能再送去定位的题面。 */
export function normalizeOcrText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line.length > 0)
    .join('\n')
}