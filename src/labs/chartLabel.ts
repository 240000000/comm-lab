/**
 * 课程视图画布的无障碍描述（纯函数，不碰 DOM）。
 *
 * canvas 对读屏器是一块空白：没有 role、没有 aria-label 时，读到的只有
 * 「图形」两个字。这里把一屏图压成一句人话：第几章、章名、这一章要回答的
 * 那句话，最后附上三个读数的名字与值——只报数不报名字，读屏器念出
 * 「0.02、1.00、0.00」等于没念。
 *
 * 不拼结论句：结论动辄四五句，塞进 aria-label 会让读屏器一次念很久，
 * 反而听不到自己要找的那个数。结论在页面上是正文，读屏器本来就能读到。
 */

export type ChartLabelInput = {
  /** 章节号，从 1 起。 */
  no: number
  /** 章名。 */
  title: string
  /** 这一章要回答的那句话。 */
  question: string
  /** 当前读数（名字 + 已经格式化好的值）。 */
  readouts: ReadonlyArray<{ label: string; value: string }>
}

/** 问句结尾的句号、问号不念，去掉；逗号分号留着，念起来有停顿。 */
function trimTail(text: string): string {
  return text.replace(/[。．.！!？?]+$/u, '').trim()
}

/**
 * 「第 6 章 · 数字基带传输系统：眼图张开多大…；读数 抖动 0.02、张开度 1.00、门限 0.00」
 * 没有读数时只报章节与问句，不留下一个孤零零的分号。
 */
export function chartLabel(input: ChartLabelInput): string {
  const head = `第 ${input.no} 章 · ${input.title}：${trimTail(input.question)}`
  const readings = input.readouts
    .map((readout) => `${readout.label} ${readout.value}`)
    .filter((text) => text.trim() !== '')
  return readings.length > 0 ? `${head}；读数 ${readings.join('、')}` : head
}