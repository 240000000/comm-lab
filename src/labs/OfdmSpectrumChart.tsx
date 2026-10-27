/**
 * 频域图：64 个子载波上的接收点，按各自子载波的复增益归一化之后
 * 应该落在四个 ±1 的角上。没有码间干扰时，点是贴在角上的；
 * 拖尾压进数据段之后，点就开始往外糊。
 *
 * 空心方框是理想位置（QPSK 的四个角），实心点是接收到的点。
 */
import { useEffect, useRef } from 'react'

import type { Complex } from '../core/dft.ts'
import { QPSK } from '../core/ofdm.ts'

const SIZE = 300
const PAD = 40
const LIMIT = 2

const COLOR = {
  grid: '#131c25',
  axis: '#2b4356',
  ideal: '#5c6b7a',
  point: '#3ce3c6',
  pointWarn: '#ffb054',
}

export function OfdmSpectrumChart({
  points,
  accent,
  hasError,
}: {
  points: Complex[]
  accent: string
  hasError: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(SIZE * dpr)
    canvas.height = Math.round(SIZE * dpr)
    canvas.style.width = `${SIZE}px`
    canvas.style.height = `${SIZE}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const plot = SIZE - PAD * 2
    const xOf = (v: number) => PAD + ((v + LIMIT) / (2 * LIMIT)) * plot
    const yOf = (v: number) => PAD + ((LIMIT - v) / (2 * LIMIT)) * plot

    ctx.clearRect(0, 0, SIZE, SIZE)

    // 网格：±1 的两条线，就是四个理想点所在的位置
    ctx.strokeStyle = COLOR.grid
    ctx.setLineDash([3, 5])
    ctx.lineWidth = 1
    for (const v of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(xOf(v), PAD)
      ctx.lineTo(xOf(v), SIZE - PAD)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(PAD, yOf(v))
      ctx.lineTo(SIZE - PAD, yOf(v))
      ctx.stroke()
    }
    ctx.setLineDash([])

    // 坐标轴
    ctx.strokeStyle = COLOR.axis
    ctx.beginPath()
    ctx.moveTo(PAD, yOf(0))
    ctx.lineTo(SIZE - PAD + 6, yOf(0))
    ctx.moveTo(xOf(0), SIZE - PAD)
    ctx.lineTo(xOf(0), PAD - 6)
    ctx.stroke()

    // 理想位置：空心方框
    ctx.strokeStyle = COLOR.ideal
    ctx.lineWidth = 1.2
    for (const p of QPSK) {
      const x = xOf(p.re)
      const y = yOf(p.im)
      ctx.strokeRect(x - 4, y - 4, 8, 8)
    }

    // 接收点
    const dotColor = hasError ? COLOR.pointWarn : accent
    ctx.fillStyle = dotColor
    for (const p of points) {
      const x = xOf(Math.max(-LIMIT, Math.min(LIMIT, p.re)))
      const y = yOf(Math.max(-LIMIT, Math.min(LIMIT, p.im)))
      ctx.beginPath()
      ctx.arc(x, y, 2.3, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = '#7f93a8'
    ctx.font = '11px Consolas, "Cascadia Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillText('I', SIZE - PAD + 8, yOf(0) + 4)
    ctx.fillText('Q', xOf(0) + 4, PAD - 8)
  }, [points, accent, hasError])

  return (
    <div className="constellation-frame">
      <canvas
        ref={canvasRef}
        className="constellation"
        role="img"
        aria-label={hasError ? '有码间干扰的子载波接收点' : '干净的 64 个子载波接收点'}
      />
    </div>
  )
}
