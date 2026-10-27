/**
 * 卷积码对照曲线：不编码、硬判决、软判决三条线画在同一个坐标系里。
 *
 * 横轴 Eb/N0 线性（0–10 dB），纵轴 BER 对数（1 → 1e-6）。
 * 三条线都来自同一批信噪比、同一规模样本；零错误点画空心圈，
 * 位置摆在这批样本能分辨的最低位 1/比特数 上，不硬连线。
 */
import { useEffect, useRef } from 'react'
import type { ConvCurvePoint } from '../core/convCurve'

const WIDTH = 560
const HEIGHT = 280
const PAD_LEFT = 74
const PAD_RIGHT = 18
const PAD_TOP = 16
const PAD_BOTTOM = 54
const DECADES = 6

const COLOR = {
  grid: '#131c25',
  axis: '#2b4356',
  axisText: '#6f8399',
  uncoded: '#93a4b8',
  hard: '#ffb054',
  soft: '#3ce3c6',
  hollow: '#5c6b7a',
} as const

const AXIS_FONT = '11px Consolas, "Cascadia Mono", monospace'

type Props = {
  points: ConvCurvePoint[]
  fromDb: number
  toDb: number
}

type Series = {
  key: 'uncoded' | 'hard' | 'soft'
  label: string
  color: string
  value: (point: ConvCurvePoint) => number
  errors: (point: ConvCurvePoint) => number
}

const SERIES: Series[] = [
  { key: 'uncoded', label: '不编码', color: COLOR.uncoded, value: (p) => p.uncoded, errors: (p) => p.uncodedErrors },
  { key: 'hard', label: '硬判决', color: COLOR.hard, value: (p) => p.hard, errors: (p) => p.hardErrors },
  { key: 'soft', label: '软判决', color: COLOR.soft, value: (p) => p.soft, errors: (p) => p.softErrors },
]

export function ConvCurveChart({ points, fromDb, toDb }: Props) {
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
    const toX = (db: number) => PAD_LEFT + ((db - fromDb) / (toDb - fromDb)) * plotW
    const toY = (ber: number) => PAD_TOP + (-Math.log10(Math.max(ber, 1e-7)) / DECADES) * plotH

    // 每个数量级一条虚线。
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

    // 坐标轴。
    ctx.strokeStyle = COLOR.axis
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, PAD_TOP)
    ctx.lineTo(PAD_LEFT, PAD_TOP + plotH)
    ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH)
    ctx.stroke()

    // 纵轴刻度。
    ctx.font = AXIS_FONT
    ctx.fillStyle = COLOR.axisText
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let d = 0; d <= DECADES; d += 1) {
      const y = PAD_TOP + (d / DECADES) * plotH
      ctx.fillText(d === 0 ? '1' : `1e-${d}`, PAD_LEFT - 8, y)
    }

    // 横轴刻度：每 2 dB 一个数字。
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const point of points) {
      if ((point.ebN0 - fromDb) % 2 !== 0) continue
      ctx.fillText(`${point.ebN0}`, toX(point.ebN0), PAD_TOP + plotH + 9)
    }
    ctx.fillText('每信息比特信噪比 Eb/N0 (dB)', PAD_LEFT + plotW / 2, PAD_TOP + plotH + 30)
    ctx.save()
    ctx.translate(16, PAD_TOP + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText('误比特率 BER', 0, 0)
    ctx.restore()

    // 不编码的理论线：Q(√(2Eb/N0))，灰色虚线，全程连贯。
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = COLOR.uncoded
    ctx.lineWidth = 1.2
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = toX(point.ebN0)
      const y = toY(point.theory)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.restore()

    // 三条实测线：只把「两端都真测到错」的相邻点连起来。
    for (const series of SERIES) {
      ctx.strokeStyle = series.color
      ctx.lineWidth = 1.8
      for (let k = 0; k < points.length - 1; k += 1) {
        const a = points[k]
        const b = points[k + 1]
        if (series.errors(a) === 0 || series.errors(b) === 0) continue
        ctx.beginPath()
        ctx.moveTo(toX(a.ebN0), toY(series.value(a)))
        ctx.lineTo(toX(b.ebN0), toY(series.value(b)))
        ctx.stroke()
      }
    }

    // 点：实心 = 测到了错；空心 = 这批样本一个错都没有。
    for (const series of SERIES) {
      for (const point of points) {
        const x = toX(point.ebN0)
        const hollow = series.errors(point) === 0
        const y = toY(hollow ? 1 / point.bits : series.value(point))
        ctx.beginPath()
        ctx.arc(x, y, hollow ? 2.8 : 3.2, 0, Math.PI * 2)
        ctx.fillStyle = hollow ? '#0d151d' : series.color
        ctx.strokeStyle = hollow ? COLOR.hollow : series.color
        ctx.lineWidth = 1.4
        ctx.fill()
        ctx.stroke()
      }
    }

    // 图例：三块色标 + 一段虚线说明。
    const legendY = PAD_TOP + 6
    ctx.font = AXIS_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    let cursor = PAD_LEFT + plotW - 196
    for (const series of SERIES) {
      ctx.fillStyle = series.color
      ctx.beginPath()
      ctx.arc(cursor, legendY, 3.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = COLOR.axisText
      ctx.fillText(series.label, cursor + 7, legendY)
      cursor += 7 + ctx.measureText(series.label).width + 14
    }
  }, [points, fromDb, toDb])

  return (
    <figure className="curve-figure">
      <div className="curve-frame">
        <canvas
          ref={canvasRef}
          className="curve"
          role="img"
          aria-label={`卷积码对照曲线：${fromDb} 到 ${toDb} dB 共 ${points.length} 个信噪比点，三条实测线为不编码、硬判决、软判决；空心点表示该点样本里没有测到比特错误`}
        />
      </div>
      <figcaption>
        横轴是每信息比特的信噪比，纵轴是对数刻度的误比特率。灰虚线是不编码 BPSK 的理论值；
        三个实心/空心点系列是同一条链路实测的三组结果。空心点表示这批样本里一个比特都没错，
        位置摆在这批样本能分辨的 1/{points[0]?.bits.toLocaleString('en-US') ?? '—'}，不连线。
      </figcaption>
    </figure>
  )
}
