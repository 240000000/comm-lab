/**
 * 课程视图的通用折线件。
 *
 * 各章的数据形状各不相同（时域波形、频谱包络、量化台阶、误码率曲线），
 * 但画法只有一种：横轴取参数，纵轴取幅度，一条或几条线同坐标系叠着。
 * 所以这里只认「一组带名字和颜色的点」，不认具体是哪一章。
 *
 * 第 7 章起多两个开关：logY 把纵轴换成对数刻度（误码率跨好几个数量级），
 * marker 让某条 series 只画散点（蒙特卡洛实测点，不连成线）。
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

/** 对数轴上 0 没法画，取一个比任何误码率都小的正数兜底。 */
const LOG_FLOOR = 1e-12

export function CourseChart({
  series,
  xLabel,
  yLabel,
  logY = false,
}: {
  series: CourseSeries[]
  xLabel: string
  yLabel: string
  logY?: boolean
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

    // 纵坐标先过一遍 log10，后面所有映射都按变换后的值算。
    const ty = (value: number) => (logY ? Math.log10(Math.max(value, LOG_FLOOR)) : value)

    // 先扫一遍所有点，定出两个轴的取值范围；y 轴上下各留一点余量，免得线贴边。
    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    for (const s of series) {
      ctx.globalAlpha = s.quiet ? 0.18 : 1
      ctx.lineWidth = s.quiet ? 0.8 : s.dashed ? 1.1 : 1.4
      for (const [x, y] of s.points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        xMin = Math.min(xMin, x)
        xMax = Math.max(xMax, x)
        const yv = ty(y)
        yMin = Math.min(yMin, yv)
        yMax = Math.max(yMax, yv)
      }
    }
    // 上面扫范围时改过 globalAlpha，画坐标轴和刻度之前必须复位，
    // 否则以后调整 series 顺序，坐标轴会变成 18% 透明度。
    ctx.globalAlpha = 1
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return
    if (xMax === xMin) xMax = xMin + 1
    if (yMax === yMin) {
      yMin -= 1
      yMax += 1
    }
    const yPad = (yMax - yMin) * (logY ? 0.05 : 0.08)
    yMin -= yPad
    yMax += yPad

    const px = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * plotW
    const py = (y: number) => PAD.top + (1 - (ty(y) - yMin) / (yMax - yMin)) * plotH

    // 对数轴把上下界对齐到整十次幂，刻度落在 10^k 上，读起来才是 1e-2、1e-4 这种整档。
    if (logY) {
      yMin = Math.floor(yMin) - 0.15
      yMax = Math.ceil(yMax) + 0.15
      if (yMax - yMin < 2) yMax = yMin + 2
    }
    // 纵向刻度值：线性轴 5 档等分；对数轴每十倍一档，太密时隔档画。
    const yTicks: number[] = []
    if (logY) {
      const step = Math.ceil((yMax - yMin) / 8)
      for (let k = Math.ceil(yMin); k <= Math.floor(yMax); k += step) yTicks.push(k)
    } else {
      for (let i = 0; i <= 4; i++) yTicks.push(yMax - ((yMax - yMin) / 4) * i)
    }

    // 网格：竖线 4 条；横线跟着纵向刻度走。
    ctx.strokeStyle = COLOR.grid
    ctx.lineWidth = 1
    for (const value of yTicks) {
      const y = PAD.top + (1 - (value - yMin) / (yMax - yMin)) * plotH
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(PAD.left + plotW, y)
      ctx.stroke()
    }
    for (let i = 0; i <= 4; i++) {
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

    // 刻度文字：横轴 0、1/4、1/2、3/4、1；纵轴按上面算好的刻度值写。
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
    for (const value of yTicks) {
      const y = PAD.top + (1 - (value - yMin) / (yMax - yMin)) * plotH
      ctx.fillText(logY ? formatPower(value) : formatTick(value), PAD.left - 8, y)
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

    // 线：每一条各自连点，虚线仍是虚线；迹线淡画，不抢包络；marker 只画点不连线。
    for (const s of series) {
      ctx.globalAlpha = s.quiet ? 0.18 : 1
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = s.quiet ? 0.8 : s.name === '解调输出' ? 1.8 : 1.2
      if (s.marker) {
        for (const [x, y] of s.points) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          ctx.beginPath()
          ctx.arc(px(x), py(y), 3.5, 0, Math.PI * 2)
          ctx.fill()
        }
        continue
      }
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
    ctx.globalAlpha = 1

    // 图例放右上角，压在网格上，不动轴；先铺一块半透明底，曲线穿过去也不糊。
    const legendItems = series.filter((s) => !s.quiet)
    if (legendItems.length > 0) {
      ctx.fillStyle = 'rgba(9, 15, 22, 0.82)'
      ctx.fillRect(PAD.left + plotW - 112, PAD.top + 2, 112, legendItems.length * 18 + 6)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = '12px "Noto Sans SC", "Microsoft YaHei", sans-serif'
    let legendY = PAD.top + 11
    for (const s of legendItems) {
      ctx.fillStyle = s.color
      ctx.strokeStyle = s.color
      if (s.marker) {
        ctx.beginPath()
        ctx.arc(PAD.left + plotW - 80, legendY, 3.5, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.lineWidth = s.dashed ? 1.2 : 1.8
        ctx.setLineDash(s.dashed ? [4, 4] : [])
        ctx.beginPath()
        ctx.moveTo(PAD.left + plotW - 96, legendY)
        ctx.lineTo(PAD.left + plotW - 64, legendY)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.fillStyle = COLOR.axisText
      ctx.fillText(s.name, PAD.left + plotW, legendY)
      legendY += 18
    }
  }, [series, xLabel, yLabel, logY])

  return <canvas className="course-canvas" ref={ref} style={{ height: HEIGHT }} />
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0)
  if (Math.abs(value) >= 10) return value.toFixed(1)
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toFixed(3)
}

/** 对数轴的刻度：value 是 log10 后的值，回成 10^k 再写短式子。 */
function formatPower(value: number): string {
  const power = Math.round(value)
  if (Math.abs(value - power) < 0.05) return `1e${power}`
  return `1e${value.toFixed(1)}`
}
