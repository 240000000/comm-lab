/**
 * 卷积码（约束长度 3、码率 1/2、生成多项式 7 与 5）。
 *
 * 一、编码器长什么样
 * 三个比特参与异或：当前输入 u_t、上一拍 u_{t-1}、上上拍 u_{t-2}。
 * 生成多项式写成八进制，7 = 111，意思是「这三位全参与」；
 * 5 = 101，意思是「首尾参与、中间那一位不参与」。所以每个输入比特吐出两个码比特：
 *
 *   out1 = u_t ⊕ u_{t-1} ⊕ u_{t-2}        （7）
 *   out2 = u_t           ⊕ u_{t-2}        （5）
 *
 * 状态就是寄存器里剩下两位 [u_{t-1}, u_{t-2}]，一共 4 个状态，所以叫约束长度 3（3 位窗口）
 * 的 4 状态码。
 *
 * 二、末尾补零是干什么的
 * 寄存器的初始值是 00。发完最后一个信息比特时，寄存器里还留着两位历史，
 * 这时如果直接停，最后两个码字对应的「从哪个状态出发」是不确定的——
 * 译码器不知道收尾该回到哪个状态，只能猜。
 * 补两个 0 进去，是让寄存器在收尾这两拍里逐步归零，于是码字一定结束在状态 00：
 * 译码器有了确定的终点，回溯路径唯一。补零不是玄学，就是给码字加一个已知的终止条件。
 *
 * 三、码距
 * 任意两条码序列（同一起点、不同信息）之间不同的比特数，最小那个叫自由距离 dfree。
 * 这个码的 dfree = 5（由 freeDistance() 在网格上搜出来，不是背的）。
 * 距离越大，两条码序列在噪声里被混淆得越晚，纠错能力越强。
 */
import type { Rng } from './rng.ts'

/** 约束长度：3 位窗口 → 2 位记忆 → 4 个状态。 */
export const CONSTRAINT_LENGTH = 3
export const MEMORY = CONSTRAINT_LENGTH - 1
export const STATES = 1 << MEMORY
/** 生成多项式，八进制 7 与 5。 */
export const POLYS = [0b111, 0b101] as const

export type TrellisEdge = {
  /** 出发状态（寄存器里的两位历史，高位是 u_{t-1}）。 */
  from: number
  /** 这一拍输入的比特。 */
  input: 0 | 1
  /** 下一拍的状态。 */
  to: number
  /** 这一拍吐出的两个码比特。 */
  out: [number, number]
}

const parity = (value: number): number => {
  let bits = 0
  let rest = value
  while (rest > 0) {
    bits ^= rest & 1
    rest >>= 1
  }
  return bits
}

/**
 * 把网格一次性算出来：4 个状态 × 2 种输入 = 8 条边。
 * 每条边记下「从哪来、输入什么、到哪去、吐出什么」，编码和译码共用这一份。
 */
export function buildTrellis(): TrellisEdge[] {
  const edges: TrellisEdge[] = []
  for (let from = 0; from < STATES; from += 1) {
    for (const input of [0, 1] as const) {
      // 三位窗口：高位是当前输入，低两位是状态。
      const windowBits = (input << MEMORY) | from
      const out: [number, number] = [
        parity(windowBits & POLYS[0]),
        parity(windowBits & POLYS[1]),
      ]
      // 输入挤进最高位，最老的一位被挤出去。
      const to = (windowBits >> 1) & (STATES - 1)
      edges.push({ from, input, to, out })
    }
  }
  return edges
}

export type EncodeResult = {
  /** 编码后的码比特，长度是 2 ×（信息比特 + 补零比特）。 */
  coded: number[]
  /** 补了几个零。 */
  tailBits: number
  /** 每一拍之后寄存器里的状态，画网格路径用。 */
  statePath: number[]
}

/**
 * 编码。
 *
 * terminate = true 时在末尾补 MEMORY 个 0，把寄存器清零；
 * 关掉它就得到一条「停在半路」的码字——只有对比实验才需要。
 */
export function encodeConvolutional(bits: number[], terminate = true): EncodeResult {
  const edges = buildTrellis()
  const byFrom = new Map<number, TrellisEdge[]>()
  for (const edge of edges) {
    const list = byFrom.get(edge.from) ?? []
    list.push(edge)
    byFrom.set(edge.from, list)
  }

  const inputBits = terminate ? [...bits, ...new Array<number>(MEMORY).fill(0)] : [...bits]
  const coded: number[] = []
  const statePath: number[] = []
  let state = 0
  for (const bit of inputBits) {
    const edge = byFrom.get(state)!.find((candidate) => candidate.input === bit)
    if (!edge) throw new Error(`状态 ${state} 没有输入 ${bit} 对应的边`)
    coded.push(edge.out[0], edge.out[1])
    statePath.push(edge.to)
    state = edge.to
  }
  return { coded, tailBits: terminate ? MEMORY : 0, statePath }
}

/**
 * 硬判决 Viterbi：先把每个码比特切成 0/1，再按汉明距离比。
 *
 * 这一版眼里的世界只有「不一样 = 记 1 分」，各比特错得一样严重；
 * 一个「刚好越过判决门限」的比特和一个「离门限十万八千里」的比特，得分相同。
 */
export function decodeHard(coded: number[]): number[] {
  const edges = buildTrellis()
  const steps = Math.floor(coded.length / 2)
  let cost = new Float64Array(STATES).fill(Number.POSITIVE_INFINITY)
  cost[0] = 0
  const prevState = new Int32Array(steps * STATES).fill(-1)
  const prevInput = new Int8Array(steps * STATES).fill(-1)

  for (let step = 0; step < steps; step += 1) {
    const next = new Float64Array(STATES).fill(Number.POSITIVE_INFINITY)
    const received0 = coded[2 * step]
    const received1 = coded[2 * step + 1]
    for (const edge of edges) {
      if (!Number.isFinite(cost[edge.from])) continue
      // 汉明距离：两个码比特里错了几位。
      const branch =
        (edge.out[0] === received0 ? 0 : 1) + (edge.out[1] === received1 ? 0 : 1)
      const total = cost[edge.from] + branch
      if (total < next[edge.to]) {
        next[edge.to] = total
        prevState[step * STATES + edge.to] = edge.from
        prevInput[step * STATES + edge.to] = edge.input
      }
    }
    cost = next
  }

  return traceback(prevState, prevInput, steps, 0)
}

/**
 * 软判决 Viterbi：不切比特，直接拿接收符号到 ±1 两个理想点的距离当度量。
 *
 * 差别在度量：硬判决只用「错没错」，软判决还知道「错了多远」——
 * 一个收到 0.02 的比特（几乎肯定本来是 1）和一个收到 0.49 的比特（摇摆不定）
 * 在软判决里权重完全不同，硬判决里两者都被记成「与 1 相差 1」。
 * 这就是软判决在低信噪比能多挣几个 dB 的全部原因。
 *
 * received 是长度 2×步数 的接收幅度数组（BPSK：理想值是 -1 与 +1）。
 */
export function decodeSoft(received: number[]): number[] {
  const edges = buildTrellis()
  const steps = Math.floor(received.length / 2)
  let cost = new Float64Array(STATES).fill(Number.POSITIVE_INFINITY)
  cost[0] = 0
  const prevState = new Int32Array(steps * STATES).fill(-1)
  const prevInput = new Int8Array(steps * STATES).fill(-1)

  for (let step = 0; step < steps; step += 1) {
    const next = new Float64Array(STATES).fill(Number.POSITIVE_INFINITY)
    const received0 = received[2 * step]
    const received1 = received[2 * step + 1]
    for (const edge of edges) {
      if (!Number.isFinite(cost[edge.from])) continue
      const ideal0 = edge.out[0] === 0 ? -1 : 1
      const ideal1 = edge.out[1] === 0 ? -1 : 1
      // 欧氏距离的平方：离理想点越远，这笔账越贵。
      const branch = (received0 - ideal0) ** 2 + (received1 - ideal1) ** 2
      const total = cost[edge.from] + branch
      if (total < next[edge.to]) {
        next[edge.to] = total
        prevState[step * STATES + edge.to] = edge.from
        prevInput[step * STATES + edge.to] = edge.input
      }
    }
    cost = next
  }

  return traceback(prevState, prevInput, steps, 0)
}

/** 从终止状态往回走，把每一拍输入的比特收集起来。 */
function traceback(
  prevState: Int32Array,
  prevInput: Int8Array,
  steps: number,
  endState: number,
): number[] {
  const bits: number[] = []
  let state = endState
  for (let step = steps - 1; step >= 0; step -= 1) {
    const input = prevInput[step * STATES + state]
    if (input < 0) break
    bits.push(input)
    state = prevState[step * STATES + state]
  }
  return bits.reverse()
}

/**
 * 自由距离 dfree：在网格上从状态 0 出发、回到状态 0、又不许一开始就走全零路的那条
 * 码重最小的路径。用 Dijkstra 搜，不写死数字——生成多项式一换，这里就跟着变。
 */
export function freeDistance(): { distance: number; inputs: number[] } {
  const edges = buildTrellis()
  type Node = { state: number; weight: number; inputs: number[] }
  // 起点：任何一条「输入 1」的边，都不能算全零路径。
  const queue: Node[] = edges
    .filter((edge) => edge.from === 0 && edge.input === 1)
    .map((edge) => ({
      state: edge.to,
      weight: edge.out[0] + edge.out[1],
      inputs: [edge.input],
    }))

  let best = Number.POSITIVE_INFINITY
  let bestInputs: number[] = []

  while (queue.length > 0) {
    queue.sort((a, b) => a.weight - b.weight)
    const node = queue.shift()!
    if (node.weight >= best) continue
    if (node.state === 0) {
      // 回到 0 就收工：后面再走只会更长。
      best = node.weight
      bestInputs = node.inputs
      continue
    }
    for (const edge of edges) {
      if (edge.from !== node.state) continue
      queue.push({
        state: edge.to,
        weight: node.weight + edge.out[0] + edge.out[1],
        inputs: [...node.inputs, edge.input],
      })
    }
  }

  return { distance: best, inputs: bestInputs }
}

/** 由自由距离推出来的、页面说明里写死的那个数字。 */
export function correctionCapability(distance: number): number {
  return Math.floor((distance - 1) / 2)
}

/** BPSK：0 → -1，1 → +1。 */
export const bitToSymbol = (bit: number): number => (bit === 0 ? -1 : 1)

/** 发一串码比特，过 AWGN，返回接收幅度。 */
export function transmit(coded: number[], sigma: number, rng: Rng): number[] {
  return coded.map((bit) => bitToSymbol(bit) + sigma * rng.gauss())
}

/** 硬判决：按 0 这个门限切回比特。 */
export const sliceHard = (received: number): number => (received > 0 ? 1 : 0)
