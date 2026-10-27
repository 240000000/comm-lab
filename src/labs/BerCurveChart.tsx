/**
 * BER–SNR 曲线。
 *
 * 横轴信噪比是线性的（0–20 dB，每格 4 dB），纵轴误比特率是对数的（1 → 1e-6）。
 * 理论值画虚线，实测画成点：实心点表示这批样本里真的测到了错，
 * 空心点表示一个错都没有——那种位置不能用 log(0) 画，也不该硬连成一条线，
 * 所以只画一个空心圈，摆在「这批样本能分辨到的最低位」上（1 / 比对过的比特数）。
 */
import { useEffect, useRef } from 'react'
import type { CurvePoint } from '../core/curve'

const WIDTH = 560
const HEIGHT = 260
const PAD_LEFT = 74
const PAD_RIGHT = 18
const PAD_TOP = 16
const PAD_BOTTOM = 48

const COLOR = {
  grid: '#131c25',
  axis: '#2b4356',
  axisText: '#6f8399',
  theory: '#8f7fd4',
  measured: '#3ce3c6',
  hollow: '#7f93a8',
} as const

const AXIS_FONT = '11px Consolas, "Cascadia Mono", monospace'

type Props = {
  points: CurvePoint[]
  fromDb: number
  toDb: number
}

export function BerCurveChart({ points, fromDb, toDb }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(WIDTH * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    canvas.style.width = `${WIDTH}px`
    canvas.style.height = `${HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    const plotW = WIDTH - PAD_LEFT - PAD_RIGHT
    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM
    const DECADES = 6 // 1e0 → 1e-6
    const toX = (snr: number) => PAD_LEFT + ((snr - fromDb) / (toDb - fromDb)) * plotW
    const toY = (ber: number) => PAD_TOP + (-Math.log10(ber) / DECADES) * plotH

    // 横向刻度：每个数量级一条线。
    ctx.save()
    ctx.setLineDash([3, 6])
    ctx.strokeStyle = COLOR.grid
    ctx.lineWidth = 1
    for (let d = 0; d <= DECADES; d += 1) {
      const y = PAD_TOP + (d / DECADES) * plotH
      ctx.beginPath()
      ctx.moveTo(PAD_LEFT, y)
      ctx.lineTo(PAD_LEFT + plotW, y)
      ctx.stroke()
    }
    ctx.restore()

    // 坐标轴与刻度文字。
    ctx.strokeStyle = COLOR.axis
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, PAD_TOP)
    ctx.lineTo(PAD_LEFT, PAD_TOP + plotH)
    ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH)
    ctx.stroke()

    ctx.font = AXIS_FONT
    ctx.fillStyle = COLOR.axisText
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let d = 0; d <= DECADES; d += 1) {
      const y = PAD_TOP + (d / DECADES) * plotH
      ctx.fillText(d === 0 ? '1' : `1e-${d}`, PAD_LEFT - 8, y)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const tick of points) {
      if ((tick.snrDb - fromDb) % 4 !== 0) continue
      ctx.fillText(`${tick.snrDb}`, toX(tick.snrDb), PAD_TOP + plotH + 9)
    }
    ctx.textAlign = 'center'
    ctx.fillText('信噪比 Es/N0 (dB)', PAD_LEFT + plotW / 2, PAD_TOP + plotH + 30)
    ctx.save()
    ctx.translate(16, PAD_TOP + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText('误比特率 BER', 0, 0)
    ctx.restore()

    // 理论曲线：一条虚线，全程连贯。
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = COLOR.theory
    ctx.lineWidth = 1.5
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = toX(point.snrDb)
      const y = toY(Math.max(point.theory, 1e-7))
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.restore()

    // 实测：只把「两端都真的测到错」的相邻点连起来，其余留空。
    ctx.strokeStyle = COLOR.measured
    ctx.lineWidth = 1.8
    for (let k = 0; k < points.length - 1; k += 1) {
      const a = points[k]
      const b = points[k + 1]
      if (a.bitErrors === 0 || b.bitErrors === 0) continue
      ctx.beginPath()
      ctx.moveTo(toX(a.snrDb), toY(a.ber))
      ctx.lineTo(toX(b.snrDb), toY(b.ber))
      ctx.stroke()
    }

    // 实测点：实心 = 测到了错；空心 = 这批样本里一个错都没有。
    for (const point of points) {
      const x = toX(point.snrDb)
      const hollow = point.bitErrors === 0
      const y = toY(hollow ? 1 / point.bitCount : point.ber)
      ctx.beginPath()
      ctx.arc(x, y, hollow ? 3 : 3.2, 0, Math.PI * 2)
      ctx.fillStyle = hollow ? '#0d151d' : COLOR.measured
      ctx.strokeStyle = hollow ? COLOR.hollow : COLOR.measured
      ctx.lineWidth = 1.4
      ctx.fill()
      ctx.stroke()
    }

    // 图例。
    const legendY = PAD_TOP + 6
    ctx.font = AXIS_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = COLOR.theory
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT + plotW - 150, legendY)
    ctx.lineTo(PAD_LEFT + plotW - 126, legendY)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = COLOR.axisText
    ctx.fillText('理论', PAD_LEFT + plotW - 121, legendY)

    ctx.fillStyle = COLOR.measured
    ctx.beginPath()
    ctx.arc(PAD_LEFT + plotW - 84, legendY, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COLOR.axisText
    ctx.fillText('实测', PAD_LEFT + plotW - 75, legendY)
  }, [points, fromDb, toDb])

  return (
    <figure className="curve-figure">
      <div className="curve-frame">
        <canvas
          ref={canvasRef}
          className="curve"
          role="img"
          aria-label={`BER 曲线：${fromDb} 到 ${toDb} dB 共 ${points.length} 个信噪比点，理论值为虚线，实测为实心点，空心点表示该点样本里没有测到比特错误`}
        />
      </div>
      <figcaption>
        虚线是公式算出来的理论值，实心点是这批样本里实测的误比特率。
        空心点表示在那个信噪比下一个比特都没错——不是真的 0，而是低于这批样本能分辨的
        1/{points[0]?.bitCount.toLocaleString('en-US') ?? '—'}，所以不连线。
      </figcaption>
    </figure>
  )
}
