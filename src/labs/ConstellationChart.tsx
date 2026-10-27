/**
 * 星座图：理想点 + 接收点云。
 *
 * 两层画法是有意区分的：
 * - 理想点：暗青色、实心、半径小，永远待在它该在的位置；
 * - 接收点：琥珀色、半透明、更小，一个一个散在理想点周围。
 * 信噪比高时接收点几乎叠在理想点上，肉眼看不见；信噪比一低就散成一片云。
 *
 * 点的标签直接写在网格上会跟云团和网格线抢位置，所以：
 * 字号缩到 11px，文字先描一圈底色再填字（halo），并且标签只在理想点上画一次，
 * 不会跟着几百个接收点一起冒出来。
 */
import { useEffect, useRef } from 'react'
import { buildConstellation } from '../core/qam'
import type { Sample } from '../core/metrics'

const SIZE = 520
const PAD = 64
/** 轴线伸到最外圈点之外留一点余量，避免点贴着边框。 */
const OUTER_GAP = 1.25

const COLOR = {
  grid: '#131c25',
  axis: '#2b4356',
  ideal: '#3a828c',
  idealRing: '#0b0f14',
  cloud: 'rgba(255, 176, 84, 0.22)',
  label: '#7f93a8',
  axisText: '#6f8399',
  halo: '#0d151d',
} as const

const LABEL_FONT = '11px Consolas, "Cascadia Mono", monospace'
const AXIS_FONT = '12px Consolas, "Cascadia Mono", monospace'

type Props = {
  order: number
  /** 接收点；空数组时只画理想星座。 */
  received: Sample[]
  /** 当前信噪比，写进 aria-label 与图注。 */
  snrDb: number
}

export function ConstellationChart({ order, received, snrDb }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const points = buildConstellation(order)
    const maxLevel = Math.max(...points.map((p) => Math.max(Math.abs(p.i), Math.abs(p.q))))
    const span = Math.max(maxLevel * OUTER_GAP, 0.5)
    const dpr = Math.min(window.devicePixelRatio || 1, 3)

    const toX = (i: number) => PAD + ((i + span) / (2 * span)) * (SIZE - 2 * PAD)
    const toY = (q: number) => SIZE - PAD - ((q + span) / (2 * span)) * (SIZE - 2 * PAD)

    canvas.width = Math.round(SIZE * dpr)
    canvas.height = Math.round(SIZE * dpr)
    canvas.style.width = `${SIZE}px`
    canvas.style.height = `${SIZE}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)

    // 网格：每个星座电平一条竖线/横线，0 位置留给坐标轴。
    ctx.save()
    ctx.setLineDash([3, 6])
    ctx.strokeStyle = COLOR.grid
    ctx.lineWidth = 1
    for (const point of points) {
      if (point.i !== 0) {
        ctx.beginPath()
        ctx.moveTo(toX(point.i), PAD * 0.5)
        ctx.lineTo(toX(point.i), SIZE - PAD * 0.5)
        ctx.stroke()
      }
      if (point.q !== 0) {
        ctx.beginPath()
        ctx.moveTo(PAD * 0.5, toY(point.q))
        ctx.lineTo(SIZE - PAD * 0.5, toY(point.q))
        ctx.stroke()
      }
    }
    ctx.restore()

    // 坐标轴。
    ctx.strokeStyle = COLOR.axis
    ctx.fillStyle = COLOR.axis
    ctx.lineWidth = 1
    const axisX = toX(0)
    const axisY = toY(0)
    ctx.beginPath()
    ctx.moveTo(PAD * 0.5, axisY)
    ctx.lineTo(SIZE - PAD * 0.5, axisY)
    ctx.moveTo(axisX, SIZE - PAD * 0.5)
    ctx.lineTo(axisX, PAD * 0.5)
    ctx.stroke()
    for (const [x, y, dx, dy] of [
      [SIZE - PAD * 0.5, axisY, 1, 0],
      [axisX, PAD * 0.5, 0, -1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - dx * 7 - dy * 4, y - dy * 7 + dx * 4)
      ctx.lineTo(x - dx * 7 + dy * 4, y - dy * 7 - dx * 4)
      ctx.closePath()
      ctx.fill()
    }

    // 第一层：接收点云，半透明，不描边。
    ctx.fillStyle = COLOR.cloud
    for (const sample of received) {
      ctx.beginPath()
      ctx.arc(toX(sample.i), toY(sample.q), 2.2, 0, Math.PI * 2)
      ctx.fill()
    }

    // 第二层：理想点，暗色实心小点，压在云团上面。
    ctx.fillStyle = COLOR.ideal
    ctx.strokeStyle = COLOR.idealRing
    ctx.lineWidth = 1
    for (const point of points) {
      ctx.beginPath()
      ctx.arc(toX(point.i), toY(point.q), 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // 第三层：标签。先描底色再填字，避免与网格线糊在一起。
    ctx.font = LABEL_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const rightEdge = SIZE - PAD * 0.5 - 30
    for (const point of points) {
      const x = toX(point.i)
      const y = toY(point.q)
      const flip = x > rightEdge
      const textX = flip ? x - 7 : x + 7
      const width = ctx.measureText(point.bits).width
      const chipX = flip ? textX - width - 3 : textX - 3
      // 标签下面垫一块半透明底色：点云再密，字也不会跟琥珀色糊在一起。
      ctx.fillStyle = 'rgba(8, 13, 18, 0.78)'
      ctx.fillRect(chipX, y - 17, width + 6, 15)
      ctx.fillStyle = COLOR.label
      ctx.textAlign = flip ? 'right' : 'left'
      ctx.fillText(point.bits, textX, y - 9)
    }

    // 第四层：I / Q 轴标注。云团会把轴线整个盖住，所以放到最后画，
    // 并且跟点标签用同一套底色和字号——低信噪比时也读得出来。
    ctx.font = AXIS_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const axisMarks: [string, number, number][] = [
      ['I', SIZE - PAD * 0.5 + 13, axisY],
      ['Q', axisX, PAD * 0.5 - 14],
    ]
    for (const [text, x, y] of axisMarks) {
      const width = ctx.measureText(text).width
      ctx.fillStyle = 'rgba(8, 13, 18, 0.86)'
      ctx.fillRect(x - width / 2 - 4, y - 9, width + 8, 18)
      ctx.fillStyle = COLOR.axisText
      ctx.fillText(text, x, y)
    }
  }, [order, received, snrDb])

  return (
    <figure className="constellation-figure">
      <div className="constellation-frame">
        <canvas
          ref={canvasRef}
          className="constellation"
          role="img"
          aria-label={`${order}QAM 星座图：${buildConstellation(order).length} 个理想点，每点标出格雷码；当前信噪比 ${snrDb} dB，叠加 ${received.length} 个接收点`}
        />
      </div>
      <figcaption>
        暗青小点：理想星座位置（每点旁是 4 位格雷码标签）。琥珀色云团：
        当前信噪比下收到的点，越糊说明噪声越大。
      </figcaption>
    </figure>
  )
}
