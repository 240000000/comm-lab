/**
 * QAM 星座映射。
 *
 * 这里只做「比特 → 星座点」的静态映射：给定阶数，返回每个点的两路坐标
 * 和它的比特标签。不含噪声、不含判决、不碰界面。
 *
 * 所有函数都是纯函数：同样的输入，永远返回同样顺序、同样数值的结果。
 * 这条是硬要求——单测要能逐位比对，别人复现时也不该看到随机差异。
 */

/** 一个星座点。 */
export type QamPoint = {
  /** 同相分量（横轴） */
  i: number
  /** 正交分量（纵轴） */
  q: number
  /** 比特标签，长度等于 bitsPerSymbol(order)，最高位在前 */
  bits: string
}

/** 支持的阶数 → 每个符号携带的比特数。 */
const BITS_PER_SYMBOL: Readonly<Record<number, number>> = {
  2: 1,
  4: 2,
  16: 4,
  64: 6,
}

/**
 * 每个符号携带几个比特。
 *
 * 阶数不支持时直接抛 RangeError，不回退成 0 或 NaN——
 * 悄悄返回错误值会让后面的能量计算和判决全错，还查不出来。
 */
export function bitsPerSymbol(order: number): number {
  const bits = BITS_PER_SYMBOL[order]
  if (bits === undefined) {
    throw new RangeError(`不支持的 QAM 阶数：${order}，只接受 2、4、16、64`)
  }
  return bits
}

/** 二进制格雷码：整数 k 的格雷码是 k ^ (k >> 1)，相邻整数只差一位。 */
function gray(k: number): number {
  return k ^ (k >> 1)
}

/** 把整数写成固定位宽、高位补零的二进制串（1 → "01"）。 */
function toBits(value: number, width: number): string {
  return value.toString(2).padStart(width, '0')
}

/**
 * 生成某一阶数的完整星座图。
 *
 * **归一化**：所有星座点的能量之和除以点数等于 1，即平均符号能量 Es = 1。
 * 做法是先生成整数电平（±1、±3……），算出平均能量，再整体乘一个缩放因子。
 * 归一化是构造出来的，不是事后凑的，所以误差只有浮点本身的那一点点。
 *
 * **标签**：横轴、纵轴各自用格雷码编号，标签 = 横轴编号 + 纵轴编号。
 * 因此网格里左右相邻、上下相邻的两个点，标签恰好只差一位——
 * 这正是 QAM 用格雷码的目的：噪声让点落到隔壁时，只错一个比特。
 *
 * **顺序**：纵轴从高到低、横轴从左到右，排完一行再排下一行。
 * 这个顺序是对外承诺，界面和测试都按它取点，不许改。
 */
export function buildConstellation(order: number): QamPoint[] {
  const bits = bitsPerSymbol(order)

  // 2 阶就是 BPSK：一个比特，两个点落在横轴上。
  if (order === 2) {
    return [
      { i: -1, q: 0, bits: '0' },
      { i: 1, q: 0, bits: '1' },
    ]
  }

  const side = Math.round(Math.sqrt(order))
  const axisBits = bits / 2

  // 单轴电平：side=4 时是 -3、-1、+1、+3。
  const levels: number[] = []
  for (let k = 0; k < side; k += 1) {
    levels.push(2 * k - (side - 1))
  }

  // 单轴平方和，用来算缩放因子。
  let sumOfSquares = 0
  for (const level of levels) {
    sumOfSquares += level * level
  }

  // 每个点的平均能量 = (2 × side × Σ电平²) / 阶数，令它等于 1 解出缩放因子。
  const scale = Math.sqrt(order / (2 * side * sumOfSquares))

  const points: QamPoint[] = []
  for (let row = side - 1; row >= 0; row -= 1) {
    for (let col = 0; col < side; col += 1) {
      points.push({
        i: levels[col] * scale,
        q: levels[row] * scale,
        bits: toBits(gray(col), axisBits) + toBits(gray(row), axisBits),
      })
    }
  }
  return points
}
