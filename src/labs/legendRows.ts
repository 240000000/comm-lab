/**
 * 图例折行的纯函数。
 *
 * 图例现在是画布上方的一行普通网页元素，一行排不下就由 flex-wrap 换行。
 * 「排成几行、每行几条」这件事不该只能靠肉眼看，所以这里按 CSS 里那几个
 * 实际数值（色块 26、色块与文字间距 6、条目之间 14、字号 12）把宽度算出来，
 * 提前给出每行放几条——测试就能断言「每行都没超容器宽」。
 *
 * 字数宽度是估的，不是量的：CJK 按满字号算、ASCII 按 0.55 倍算，
 * 只用来判断放不放得下，不用于对齐。真正渲染时由浏览器按字体量。
 * 估出来偏宽（第 1 章在 279 像素容器里估成两行、实测一行），方向是安全的：
 * 凡是这里判「放得下」的，浏览器一定也放得下。
 */
export type LegendItem = { name: string; quiet?: boolean; points?: readonly unknown[] }

/**
 * 图例里该出现哪些条目——折行计算与 CourseLegend 必须走这同一个判据。
 * 两处各写一份过滤，迟早会分叉：一边少算一条，折行宽度和实际条数就对不上。
 * 空数据序列不进图例：第 3 章某些档位的集合是空的，画布上没线，
 * 图例里却挂着名字，读者会以为图没画出来。
 */
export function legendItems<T extends LegendItem>(series: T[]): T[] {
  return series.filter((item) => !item.quiet && (item.points === undefined || item.points.length > 0))
}

export const LEGEND_FONT_SIZE = 12
export const LEGEND_MARK_WIDTH = 26
export const LEGEND_MARK_GAP = 6
export const LEGEND_ITEM_GAP = 14

/** 估算一段文字占的宽度（像素，向上取整）。 */
export function legendTextWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += code >= 0x2e80 ? LEGEND_FONT_SIZE : LEGEND_FONT_SIZE * 0.55
  }
  return Math.ceil(width)
}

/** 估算一个图例条目占的宽度：色块 + 色块与文字的间距 + 文字。 */
export function legendItemWidth(name: string): number {
  return LEGEND_MARK_WIDTH + LEGEND_MARK_GAP + legendTextWidth(name)
}

export type LegendLayout = {
  /** 每行放几条。 */
  rows: number[]
  /** 每行实际占多宽，与 rows 一一对应。 */
  widths: number[]
  totalRows: number
  widestRow: number
  /** 有单条自己就比容器还宽——它独占一行，那一行必然超宽。 */
  overflow: boolean
}

/**
 * 贪心折行：能塞进当前行就塞，塞不下就另起一行。
 *
 * quiet 的 series 不进图例（与 CourseLegend 的过滤一致），所以也不参与计算。
 * 单条比容器还宽时不裁字、不截断（名字必须完整），而是让它独占一行并把
 * overflow 置真，交给调用方决定怎么提示。
 */
export function legendRows<T extends LegendItem>(series: T[], maxWidth: number): LegendLayout {
  const items = legendItems(series)
  const rows: number[] = []
  const widths: number[] = []
  let count = 0
  let width = 0
  let overflow = false

  for (const item of items) {
    const itemWidth = legendItemWidth(item.name)
    if (itemWidth > maxWidth) overflow = true
    const nextWidth = count === 0 ? itemWidth : width + LEGEND_ITEM_GAP + itemWidth
    if (count > 0 && nextWidth > maxWidth) {
      rows.push(count)
      widths.push(width)
      count = 1
      width = itemWidth
    } else {
      count += 1
      width = nextWidth
    }
  }
  if (count > 0) {
    rows.push(count)
    widths.push(width)
  }

  return {
    rows,
    widths,
    totalRows: rows.length,
    widestRow: widths.length === 0 ? 0 : Math.max(...widths),
    overflow,
  }
}
