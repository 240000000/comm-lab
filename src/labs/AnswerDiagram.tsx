import { useEffect, useRef } from 'react'
import {
  bitBoundariesMs,
  diagramFootnote,
  diagramSeconds,
  parseDiagram,
  symbolSeconds,
  type PskTimeDiagram,
} from '../answer/diagram.ts'
import { basebandLevel, carrierSample, differentialBits } from '../core/course.ts'

/**
 * 答题模式的课本级图形：原理框图 + 基带 + 带通，三段共用一条时间轴。
 *
 * 只画 `diagram.ts` 校验通过的规格；校验不过就整个不渲染（那边在卡上写一句
 * 「没有配图」）。波形一律用 `core/course.ts` 的基带极性 / 载波样值生成，
 * 这里只负责排版与上色，不掺物理。
 */

export type DiagramScheme = '2ASK' | '2PSK' | '2DPSK'

export const SCHEME_INDEX: Record<DiagramScheme, number> = { '2ASK': 0, '2PSK': 2, '2DPSK': 3 }

/** 画布逻辑宽度；高度随 showBlock 变。 */
const WIDTH = 980
const PAD_LEFT = 92
const PAD_RIGHT = 28
const BLOCK_HEIGHT = 208
const BASE_HEIGHT = 96
const BAND_HEIGHT = 156
/** 每个载波周期至少取这么多点，再按像素抽稀画。 */
const SAMPLES_PER_CYCLE = 48
const MAX_DRAW_POINTS = 24000

const INK = '#dbe6ff'
const DIM = '#8ea2c6'
const GRID = 'rgba(142,162,198,0.42)'
const ACCENT = '#3ce3c6'
const ACCENT2 = '#8f7fd4'
const BOX = '#16203a'
const BOX_EDGE = '#3d5f8f'

type Pane = {
  ctx: CanvasRenderingContext2D
  scaleX: (seconds: number) => number
  totalSeconds: number
  baseTop: number
  blockTop: number
  bandTop: number
  baseAmp: number
  bandAmp: number
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 8) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function box(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  sub?: string,
) {
  ctx.save()
  roundRect(ctx, x, y, w, h, 9)
  ctx.fillStyle = BOX
  ctx.fill()
  ctx.strokeStyle = BOX_EDGE
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 15px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(title, x + w / 2, y + h / 2 - (sub ? 9 : 0))
  if (sub) {
    ctx.fillStyle = DIM
    ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText(sub, x + w / 2, y + h / 2 + 11)
  }
  ctx.restore()
}

function arrow(ctx: CanvasRenderingContext2D, from: number, to: number, y: number) {
  ctx.save()
  ctx.strokeStyle = DIM
  ctx.fillStyle = DIM
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(from, y)
  ctx.lineTo(to - 7, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(to, y)
  ctx.lineTo(to - 8, y - 4.5)
  ctx.lineTo(to - 8, y + 4.5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function blockDiagram(pane: Pane, spec: PskTimeDiagram, scheme: DiagramScheme) {
  const { ctx } = pane
  const top = pane.blockTop
  const rowY = top + 44
  const h = 56
  const w = 132
  const gap = 44
  const left = PAD_LEFT + 20
  const xs = [0, 1, 2, 3].map((i) => left + i * (w + gap))

  const bitsPreview = spec.bits.split('').slice(0, 6).join(' ')
  box(ctx, xs[0], rowY, w, h, '数字信息', bitsPreview)
  box(ctx, xs[1], rowY, w, h, '极性变换', scheme === '2ASK' ? '单极性 NRZ' : '单极性→双极性')
  box(ctx, xs[2], rowY, w, h, '乘法器', '×')
  box(ctx, xs[3], rowY, w, h, '带通滤波器', 'BPF')
  for (let i = 0; i < 3; i += 1) arrow(ctx, xs[i] + w, xs[i + 1], rowY + h / 2)

  // 载波源从下面进乘法器。
  const carrierY = rowY + h + 46
  box(ctx, xs[2], carrierY, w, h, '载波源', 'cos ω_c t')
  arrow(ctx, xs[2] + w / 2, rowY + h, carrierY)

  ctx.save()
  ctx.fillStyle = DIM
  ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(
    scheme === '2ASK' ? '2ASK：载波的通断跟着比特走' : scheme === '2DPSK' ? '2DPSK：先差分编码，再相位键控' : '2PSK：相位跟着比特翻 0 / π',
    PAD_LEFT,
    carrierY + h / 2 + 4,
  )
  ctx.restore()
}

function draw(canvas: HTMLCanvasElement, spec: PskTimeDiagram, scheme: DiagramScheme) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const showBlock = spec.showBlock
  const bits = spec.bits.split('').map(Number)
  const totalSeconds = diagramSeconds(spec)
  const stepSeconds = symbolSeconds(spec)

  const blockTop = 14
  const baseTop = blockTop + (showBlock ? BLOCK_HEIGHT : 0) + 28
  const bandTop = baseTop + BASE_HEIGHT + 42
  const height = bandTop + BAND_HEIGHT + 42

  canvas.width = Math.round(WIDTH * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = '100%'
  canvas.style.height = 'auto'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, WIDTH, height)
  ctx.fillStyle = '#0c1424'
  ctx.fillRect(0, 0, WIDTH, height)

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT
  const scaleX = (seconds: number) => PAD_LEFT + (seconds / totalSeconds) * plotW
  const pane: Pane = {
    ctx,
    scaleX,
    totalSeconds,
    baseTop,
    blockTop,
    bandTop,
    baseAmp: BASE_HEIGHT / 2 - 10,
    bandAmp: BAND_HEIGHT / 2 - 12,
  }

  if (showBlock) blockDiagram(pane, spec, scheme)

  const baseMid = baseTop + BASE_HEIGHT / 2
  const bandMid = bandTop + BAND_HEIGHT / 2
  const baseAmp = pane.baseAmp
  const bandAmp = pane.bandAmp

  // 每码元送出的极性：2DPSK 先差分编码，其余按比特直取。
  const phaseBits = scheme === '2DPSK' ? differentialBits(bits) : bits
  const schemeIndex = SCHEME_INDEX[scheme]
  const levels = phaseBits.map((bit) => basebandLevel(schemeIndex, bit))

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ACCENT
  ctx.font = '600 13px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(scheme === '2ASK' ? '基带（单极性）' : '双极性基带 s(t)', 12, baseTop - 2)
  ctx.fillText('带通信号', 12, bandTop - 24)
  ctx.restore()

  // 上下两条 ±1 虚线（2ASK 用 0 / 1 两条实线的位置，仍按同一比例画）。
  const dashed = (y: number) => {
    ctx.save()
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, y)
    ctx.lineTo(PAD_LEFT + plotW, y)
    ctx.stroke()
    ctx.restore()
  }
  dashed(baseMid - baseAmp)
  dashed(baseMid + baseAmp)
  dashed(bandMid - bandAmp)
  dashed(bandMid + bandAmp)

  // 码元边界：竖虚线从上贯到底。
  const boundariesMs = bitBoundariesMs(spec)
  boundariesMs.forEach((ms, index) => {
    const x = scaleX(ms / 1000)
    ctx.save()
    ctx.setLineDash([5, 5])
    // 码元分界要看得见：中间的分界比两端更实一点。
    ctx.strokeStyle = index === 0 || index === boundariesMs.length - 1 ? GRID : 'rgba(142,162,198,0.72)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(x, (showBlock ? blockTop + 8 : baseTop - 26))
    ctx.lineTo(x, bandTop + BAND_HEIGHT + 6)
    ctx.stroke()
    ctx.restore()
  })

  // 每位上方标 0 / 1。
  ctx.save()
  ctx.fillStyle = INK
  ctx.font = '600 13px "Consolas", "Microsoft YaHei", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  bits.forEach((bit, index) => {
    const x = scaleX((index + 0.5) * stepSeconds)
    ctx.fillText(String(bit), x, baseTop - 26)
  })
  ctx.restore()

  // 第二段：基带方波，一个码元一段。
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 2
  ctx.beginPath()
  levels.forEach((level, index) => {
    const x0 = scaleX(index * stepSeconds)
    const x1 = scaleX((index + 1) * stepSeconds)
    const y = scheme === '2ASK' ? baseMid - level * baseAmp : baseMid - level * baseAmp
    if (index === 0) ctx.moveTo(x0, y)
    else ctx.lineTo(x0, y)
    ctx.lineTo(x1, y)
  })
  ctx.stroke()
  ctx.restore()

  // 第三段：带通波形 = 基带极性 × 载波。每个载波周期至少 48 点，画时按像素抽稀。
  const dt = 1 / (SAMPLES_PER_CYCLE * spec.carrierHz)
  const count = Math.max(2, Math.floor(totalSeconds / dt) + 1)
  const stride = Math.max(1, Math.ceil(count / MAX_DRAW_POINTS))
  ctx.save()
  ctx.strokeStyle = ACCENT2
  ctx.lineWidth = 1.4
  ctx.beginPath()
  let started = false
  for (let i = 0; i < count; i += stride) {
    const seconds = i * dt
    const index = Math.min(levels.length - 1, Math.floor(seconds / stepSeconds))
    const value = levels[index] * carrierSample(spec.carrierHz, seconds)
    const x = scaleX(seconds)
    const y = bandMid - value * bandAmp
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()

  // 第三段上方标相位（或 2ASK 的有无载波）。
  ctx.save()
  ctx.fillStyle = DIM
  ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  phaseBits.forEach((bit, index) => {
    const x = scaleX((index + 0.5) * stepSeconds)
    const text = scheme === '2ASK' ? (bit === 1 ? '有载波' : '无') : bit === 1 ? '0' : 'π'
    ctx.fillText(text, x, bandTop - 8)
  })
  ctx.restore()

  // 横轴：t / ms。
  const axisY = bandTop + BAND_HEIGHT + 18
  ctx.save()
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_LEFT, axisY)
  ctx.lineTo(PAD_LEFT + plotW, axisY)
  ctx.stroke()
  ctx.fillStyle = DIM
  ctx.font = '12px "Consolas", "Microsoft YaHei", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const stepLabel = boundariesMs.length > 9 ? 2 : 1
  boundariesMs.forEach((ms, index) => {
    if (index % stepLabel !== 0 && index !== boundariesMs.length - 1) return
    const x = scaleX(ms / 1000)
    ctx.beginPath()
    ctx.moveTo(x, axisY)
    ctx.lineTo(x, axisY + 4)
    ctx.stroke()
    ctx.fillText(ms.toFixed(ms % 1 === 0 ? 0 : 1), x, axisY + 6)
  })
  ctx.textAlign = 'right'
  ctx.fillStyle = DIM
  ctx.fillText('t / ms', PAD_LEFT - 10, axisY + 6)
  ctx.restore()
}

/** 相位映射的说明：取决于这一题按哪种调制讲。 */
export function schemeNote(scheme: DiagramScheme): string {
  if (scheme === '2ASK') return '2ASK：比特 1 有载波、0 无载波（幅度键控），图上标「有载波 / 无」'
  if (scheme === '2DPSK') {
    return '2DPSK：先按 a_n ⊕ b_{n-1} 差分编码（初值 0），再按 1→0 相位、0→π 相位映射'
  }
  return '2PSK：比特 1 记 0 相位、比特 0 记 π 相位（与 2ASK 的「有/无载波」不同）'
}

export function AnswerDiagram({ spec, scheme = '2PSK' }: { spec: unknown; scheme?: DiagramScheme }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const diagram = parseDiagram(spec)
  const key = diagram ? JSON.stringify(diagram) : ''

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !diagram) return
    draw(canvas, diagram, scheme)
    // 画布尺寸随窗口宽度变化，重画一次保证清晰度。
    const onResize = () => draw(canvas, diagram, scheme)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scheme])

  if (!diagram) return null
  return (
    <figure className="answer-diagram">
      <canvas ref={canvasRef} role="img" aria-label={`${scheme} 波形：比特 ${diagram.bits}`} />
      <figcaption>
        <span>{diagramFootnote(diagram)}</span>
        <span>{schemeNote(scheme)}</span>
        <span>
          {diagram.bits.length} 个码元，{diagram.bitRate} Baud，载波 {diagram.carrierHz} Hz
        </span>
      </figcaption>
    </figure>
  )
}