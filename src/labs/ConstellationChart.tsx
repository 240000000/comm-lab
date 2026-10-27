/**
 * 静态星座图。
 *
 * 只负责「把点画出来」：坐标轴、网格、星座点、每个点的比特标签。
 * 噪声、判决、误码率都不在这里，那些是 R4 的链路。
 *
 * 高分屏：canvas 的位图尺寸按 devicePixelRatio 放大，再用 ctx.setTransform
 * 把绘制坐标缩回 CSS 像素。这样 2x 屏上线条和字是真正画出来的，
 * 而不是浏览器把 1x 位图拉伸糊掉。缩放系数只在挂载时读一次——
 * 把窗口拖到另一块不同 dpr 的屏幕上不会自动重画，需要刷新。
 */
import { useEffect, useRef } from 'react'
import { buildConstellation, bitsPerSymbol } from '../core/qam'
import type { QamPoint } from '../core/qam'

/** 画面边长（CSS 像素）。 */
const SIZE = 520

/** 绘图区到画布边缘的留白，留给坐标轴箭头和外侧的比特标签。 */
const PAD = 64

/** 最外圈的点和边框之间再留一点空隙，免得贴边。 */
const OUTER_GAP = 1.25

/** 颜色跟 index.css 的变量保持一致（canvas 读不到 CSS 变量，只能抄一份）。 */
const COLOR = {
  grid: '#17242f',
  axis: '#2b4356',
  point: '#3ce3c6',
  pointRing: '#0b0f14',
  label: '#9fb3c8',
  axisText: '#6f8399',
}

const LABEL_FONT = '12px Consolas, "Cascadia Mono", monospace'

function draw(ctx: CanvasRenderingContext2D, points: QamPoint[]): void {
  const mid = SIZE / 2
  const reach = mid - PAD

  // 坐标值到画布像素的比例：最外圈的坐标落在 reach 处，再往外留 OUTER_GAP 倍。
  let maxAbs = 0
  for (const p of points) {
    maxAbs = Math.max(maxAbs, Math.abs(p.i), Math.abs(p.q))
  }
  const scale = maxAbs === 0 ? 1 : reach / (maxAbs * OUTER_GAP)

  const toX = (i: number): number => mid + i * scale
  const toY = (q: number): number => mid - q * scale

  ctx.clearRect(0, 0, SIZE, SIZE)

  // 网格：每个星座点所在的横向/纵向位置各画一条虚线。
  const levels = Array.from(new Set(points.map((p) => p.i))).sort((a, b) => a - b)
  ctx.save()
  ctx.strokeStyle = COLOR.grid
  ctx.lineWidth = 1
  ctx.setLineDash([3, 5])
  for (const level of levels) {
    if (level === 0) continue
    ctx.beginPath()
    ctx.moveTo(toX(level), mid - reach)
    ctx.lineTo(toX(level), mid + reach)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(mid - reach, toY(level))
    ctx.lineTo(mid + reach, toY(level))
    ctx.stroke()
  }
  ctx.restore()

  // 坐标轴。
  const axisEnd = reach + 16
  ctx.save()
  ctx.strokeStyle = COLOR.axis
  ctx.fillStyle = COLOR.axis
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(mid - axisEnd, mid)
  ctx.lineTo(mid + axisEnd, mid)
  ctx.moveTo(mid, mid - axisEnd)
  ctx.lineTo(mid, mid + axisEnd)
  ctx.stroke()

  // 箭头。
  const arrow = 6
  ctx.beginPath()
  ctx.moveTo(mid + axisEnd, mid)
  ctx.lineTo(mid + axisEnd - arrow, mid - arrow / 1.6)
  ctx.lineTo(mid + axisEnd - arrow, mid + arrow / 1.6)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(mid, mid - axisEnd)
  ctx.lineTo(mid - arrow / 1.6, mid - axisEnd + arrow)
  ctx.lineTo(mid + arrow / 1.6, mid - axisEnd + arrow)
  ctx.closePath()
  ctx.fill()

  ctx.font = '13px Consolas, "Cascadia Mono", monospace'
  ctx.fillText('I', mid + axisEnd + 4, mid + 12)
  ctx.fillText('Q', mid + 6, mid - axisEnd - 6)
  ctx.restore()

  // 星座点 + 比特标签。
  ctx.save()
  ctx.font = LABEL_FONT
  for (const p of points) {
    const x = toX(p.i)
    const y = toY(p.q)

    ctx.beginPath()
    ctx.fillStyle = COLOR.point
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = COLOR.pointRing
    ctx.stroke()

    // 标签默认放在点的右上方；靠右边缘的点改放左上方，免得被裁掉。
    const flip = x + 14 + ctx.measureText(p.bits).width > SIZE - 8
    ctx.fillStyle = COLOR.label
    ctx.textAlign = flip ? 'right' : 'left'
    ctx.fillText(p.bits, flip ? x - 10 : x + 10, y - 9)
  }
  ctx.restore()
}

type Props = {
  /** 阶数，界面这轮写死 16。 */
  order: number
}

export default function ConstellationChart({ order }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(SIZE * dpr)
    canvas.height = Math.round(SIZE * dpr)
    canvas.style.width = `${SIZE}px`

    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    // 之后所有绘制都用 CSS 像素坐标，缩放交给这一行。
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    draw(ctx, buildConstellation(order))
  }, [order])

  return (
    <figure className="constellation-figure">
      <div className="constellation-frame">
        <canvas
          ref={canvasRef}
          className="constellation"
          role="img"
          aria-label={`${order}QAM 星座图，共 ${order} 个星座点，每个点标有 ${bitsPerSymbol(order)} 位格雷码标签`}
        />
      </div>
      <figcaption>
        {order}QAM 星座图 · 格雷码标签 · 平均符号能量已归一化为 1
      </figcaption>
    </figure>
  )
}
