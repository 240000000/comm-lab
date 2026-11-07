/**
 * 课程视图的通用折线件。
 *
 * 三章的数据形状各不相同（时域波形、频谱包络、量化台阶），
 * 但画法只有一种：横轴取参数，纵轴取幅度，一条或两条线同坐标系叠着。
 * 所以这里只认「一组带名字和颜色的点」，不认具体是哪一章。
 */
import { useEffect, useRef } from 'react'
import type { CourseSeries } from '../core/course.ts'

const HEIGHT = 320
const PAD = { left: 64, right: 20, top: 18, bottom: 46 }

const COLOR = {
  grid: '#131c25',
  axis: '#2b4356',
  axisText: '#6f8399',
  label: '#c6d4e3',
}

const AXIS_FONT = '11px Consolas, "Cascadia Mono", monospace'

export function CourseChart({
  series,
  xLabel,
  yLabel,
}: {
  series: CourseSeries[]
  xLabel: string
  yLabel: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const width = canvas.clientWidth || 720
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)

    const plotW = width - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom
    if (plotW <= 0 || plotH <= 0) return

    // 先扫一遍所有点，定出两个轴的取值范围；y 轴上下各留 8% 余量，免得线贴边。
    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    for (const s of series) {
      for (const [x, y] of s.points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        xMin = Math.min(xMin, x)
        xMax = Math.max(xMax, x)
        yMin = Math.min(yMin, y)
        yMax = Math.max(yMax, y)
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return
    if (xMax === xMin) xMax = xMin + 1
    if (yMax === yMin) {
      yMin -= 1
      yMax += 1
    }
    const yPad = (yMax - yMin) * 0.08
    yMin -= yPad
    yMax += yPad

    const px = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * plotW
    const py = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * plotH

    // 网格：横竖各 4 条，颜色压到背景一样淡。
    ctx.strokeStyle = COLOR.grid
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (plotH / 4) * i
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(PAD.left + plotW, y)
      ctx.stroke()
      const x = PAD.left + (plotW / 4) * i
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, PAD.top + plotH)
      ctx.stroke()
    }

    // 轴线。
    ctx.strokeStyle = COLOR.axis
    ctx.beginPath()
    ctx.moveTo(PAD.left, PAD.top)
    ctx.lineTo(PAD.left, PAD.top + plotH)
    ctx.lineTo(PAD.left + plotW, PAD.top + plotH)
    ctx.stroke()

    // 刻度文字：横轴 0、1/4、1/2、3/4、1，纵轴 5 档。
    ctx.fillStyle = COLOR.axisText
    ctx.font = AXIS_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i <= 4; i++) {
      const value = xMin + ((xMax - xMin) / 4) * i
      ctx.fillText(formatTick(value), PAD.left + (plotW / 4) * i, PAD.top + plotH + 8)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const value = yMax - ((yMax - yMin) / 4) * i
      ctx.fillText(formatTick(value), PAD.left - 8, PAD.top + (plotH / 4) * i)
    }

    // 轴名。
    ctx.fillStyle = COLOR.label
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(xLabel, PAD.left + plotW / 2, HEIGHT - 8)
    ctx.save()
    ctx.translate(14, PAD.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(yLabel, 0, 0)
    ctx.restore()

    // 线：每一条各自连点，虚线仍是虚线。
    for (const s of series) {
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.name === '解调输出' ? 1.8 : 1.2
      if (s.dashed) ctx.setLineDash([4, 4])
      else ctx.setLineDash([])
      ctx.beginPath()
      let started = false
      for (const [x, y] of s.points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (!started) {
          ctx.moveTo(px(x), py(y))
          started = true
        } else {
          ctx.lineTo(px(x), py(y))
        }
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 图例放右上角，压在网格上，不动轴。
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = '12px "Noto Sans SC", "Microsoft YaHei", sans-serif'
    let legendY = PAD.top + 8
    for (const s of series) {
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.dashed ? 1.2 : 1.8
      ctx.setLineDash(s.dashed ? [4, 4] : [])
      ctx.beginPath()
      ctx.moveTo(PAD.left + plotW - 96, legendY)
      ctx.lineTo(PAD.left + plotW - 64, legendY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = COLOR.axisText
      ctx.fillText(s.name, PAD.left + plotW, legendY)
      legendY += 18
    }
  }, [series, xLabel, yLabel])

  return <canvas className="course-canvas" ref={ref} style={{ height: HEIGHT }} />
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0)
  if (Math.abs(value) >= 10) return value.toFixed(1)
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toFixed(3)
}
