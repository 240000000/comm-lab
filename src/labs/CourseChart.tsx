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
  logX = false,
  bars = false,
  stack = false,
  guides,
}: {
  series: CourseSeries[]
  xLabel: string
  yLabel: string
  logY?: boolean
  logX?: boolean
  bars?: boolean
  stack?: boolean
  guides?: Array<{ y: number; label: string }>
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
    // 第 4 章起横轴也要对数：带宽从 0.1 kHz 跨到 1000 kHz，线性轴会把低带宽段压成一团。
    const tx = (value: number) => (logX ? Math.log10(Math.max(value, LOG_FLOOR)) : value)

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
        xMin = Math.min(xMin, tx(x))
        xMax = Math.max(xMax, tx(x))
        const yv = ty(y)
        yMin = Math.min(yMin, yv)
        yMax = Math.max(yMax, yv)
      }
    }
    // 参考虚线也是图的一部分：±4σ_T 这种带子常常比数据本身还宽，
    // 不并进取值范围的话，虚线会画到坐标区外面去，读者以为它被裁掉了。
    if (guides) {
      for (const g of guides) {
        if (!Number.isFinite(g.y)) continue
        const gv = ty(g.y)
        yMin = Math.min(yMin, gv)
        yMax = Math.max(yMax, gv)
      }
    }
    // 堆叠柱的高度是同一 x 上各段之和；取值范围必须按总高算，否则最上面那一段会顶出绘图区。
    if (stack) {
      const totals = new Map<number, number>()
      for (const s of series) {
        for (const [x, y] of s.points) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          totals.set(x, (totals.get(x) ?? 0) + y)
        }
      }
      for (const total of totals.values()) yMax = Math.max(yMax, total)
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
    const dataMin = yMin
    const yPad = (yMax - yMin) * (logY ? 0.05 : 0.08)
    yMin -= yPad
    yMax += yPad
    // 数据本身没有负值（比特、误码率、个数），下界就别留负刻度，免得读者以为存在负信息量。
    if (dataMin >= 0) yMin = 0
    // 堆叠柱数的是个数，纵轴下界必须落在 0：否则柱子从负数处往上长，看着像有负计数。
    if (stack) yMin = 0

    const px = (x: number) => PAD.left + ((tx(x) - xMin) / (xMax - xMin)) * plotW
    const py = (y: number) => PAD.top + (1 - (ty(y) - yMin) / (yMax - yMin)) * plotH

    // 对数轴把上下界对齐到整十次幂，刻度落在 10^k 上，读起来才是 1e-2、1e-4 这种整档。
    if (logY) {
      yMin = Math.floor(yMin) - 0.15
      yMax = Math.ceil(yMax) + 0.15
      if (yMax - yMin < 2) yMax = yMin + 2
    }
    if (logX) {
      xMin = Math.floor(xMin) - 0.15
      xMax = Math.ceil(xMax) + 0.15
      if (xMax - xMin < 2) xMax = xMin + 2
    }
    // 横向刻度值：线性轴 5 档等分；对数轴按整十次幂走。
    const xTicks: number[] = []
    if (logX) {
      const step = Math.ceil((xMax - xMin) / 8)
      for (let k = Math.ceil(xMin); k <= Math.floor(xMax); k += step) xTicks.push(k)
    } else {
      for (let i = 0; i <= 4; i++) xTicks.push(xMin + ((xMax - xMin) / 4) * i)
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
    for (const value of xTicks) {
      const x = PAD.left + ((value - xMin) / (xMax - xMin)) * plotW
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
    if (stack) {
      // 堆叠柱的横轴是错误个数，刻度必须是整数；标 0.750 这种小数只会让人以为能拖半位错。
      const step = Math.max(1, Math.round((xMax - xMin) / 8))
      for (let v = Math.ceil(xMin); v <= Math.floor(xMax); v += step) {
        ctx.fillText(String(v), px(v), PAD.top + plotH + 8)
      }
    } else if (logX) {
      for (const value of xTicks) {
        const x = PAD.left + ((value - xMin) / (xMax - xMin)) * plotW
        ctx.fillText(formatPower(value), x, PAD.top + plotH + 8)
      }
    } else {
      for (const value of xTicks) {
        const x = PAD.left + ((value - xMin) / (xMax - xMin)) * plotW
        ctx.fillText(formatTick(value), x, PAD.top + plotH + 8)
      }
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

    // 参考线：第 12 章用它把 −1/N 标出来，证明「只有两个值」不是画得糙。
    if (guides) {
      ctx.lineWidth = 1
      for (const g of guides) {
        const gy = py(g.y)
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = '#5c7f96'
        ctx.beginPath()
        ctx.moveTo(PAD.left, gy)
        ctx.lineTo(PAD.left + plotW, gy)
        ctx.stroke()
        ctx.setLineDash([])
        // 贴着上沿的那条线没有地方写字，标注改放到线下方，免得被裁掉。
        const above = gy - 4 > PAD.top + 10
        ctx.textAlign = 'left'
        ctx.textBaseline = above ? 'bottom' : 'top'
        // 标注底下垫一层底色：数据点常常正好压在这条线上，不垫就看不清字。
        const labelW = ctx.measureText(g.label).width
        const labelY = above ? gy - 4 : gy + 4
        ctx.fillStyle = 'rgba(9, 15, 22, 0.78)'
        ctx.fillRect(PAD.left + 3, above ? labelY - 11 : labelY - 1, labelW + 6, 13)
        ctx.fillStyle = '#8fa7b8'
        ctx.fillText(g.label, PAD.left + 6, labelY)
      }
    }

    // 柱：从 0 基线一根根拉出来，比折线更能看出「除了 τ=0 全压在同一条线上」。
    if (bars) {
      ctx.setLineDash([])
      ctx.lineWidth = 1.4
      for (const s of series) {
        ctx.strokeStyle = s.color
        const base = py(0)
        for (const [x, y] of s.points) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          // 旁瓣只有 1/N 那么矮，按真实高度画会看不见；至少留 2 像素，让它「确实存在」。
          const top = py(y)
          const tip = Math.abs(top - base) < 2 ? base - Math.sign(top - base || 1) * 2 : top
          ctx.beginPath()
          ctx.moveTo(px(x), base)
          ctx.lineTo(px(x), tip)
          ctx.stroke()
        }
      }
    }

    // 堆叠柱：横轴只有几档时，每档一根柱按结局分段，段内直接写计数。
    if (stack) {
      ctx.setLineDash([])
      const xs = [...new Set(series.flatMap((s) => s.points.map(([x]) => x)))].sort((a, b) => a - b)
      const totals = new Map<number, number>()
      for (const s of series) {
        for (const [x, y] of s.points) totals.set(x, (totals.get(x) ?? 0) + y)
      }
      const span = xs.length > 1 ? px(xs[1]) - px(xs[0]) : plotW / 2
      const barW = Math.max(18, Math.min(56, span * 0.45))
      for (const x of xs) {
        let acc = 0
        for (const s of series) {
          const point = s.points.find(([px0]) => px0 === x)
          if (!point) continue
          const y0 = py(acc)
          acc += point[1]
          const y1 = py(acc)
          if (point[1] <= 0) continue
          ctx.fillStyle = s.color
          // 只有 1 个计数的那一段按真实高度只有 2 像素，补到 3 像素，让「这一段存在」看得见。
          const height = Math.max(3, Math.abs(y0 - y1))
          ctx.fillRect(px(x) - barW / 2, Math.min(y0, y1) - (height - Math.abs(y0 - y1)), barW, height)
          if (Math.abs(y0 - y1) > 15 && point[1] > 0) {
            ctx.fillStyle = '#08121a'
            ctx.font = AXIS_FONT
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(String(point[1]), px(x), (y0 + y1) / 2)
          }
        }
      }
    }

    // 线：每一条各自连点，虚线仍是虚线；迹线淡画，不抢包络；marker 只画点不连线。
    for (const s of series) {
      if (bars || stack) break
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
    // 堆叠柱的柱子顶到绘图区上沿，图例放右上会压住最后一根；柱状图统一挪到左上角。
    const legendX = stack ? PAD.left + 12 : PAD.left + plotW - 112
    const legendLine = stack ? PAD.left + 28 : PAD.left + plotW - 96
    const legendDot = stack ? PAD.left + 44 : PAD.left + plotW - 80
    const legendText = stack ? PAD.left + 76 : PAD.left + plotW
    if (legendItems.length > 0) {
      ctx.fillStyle = 'rgba(9, 15, 22, 0.82)'
      ctx.fillRect(legendX, PAD.top + 2, stack ? 120 : 112, legendItems.length * 18 + 6)
    }
    ctx.textAlign = stack ? 'left' : 'right'
    ctx.textBaseline = 'middle'
    ctx.font = '12px "Noto Sans SC", "Microsoft YaHei", sans-serif'
    let legendY = PAD.top + 11
    for (const s of legendItems) {
      ctx.fillStyle = s.color
      ctx.strokeStyle = s.color
      if (s.marker) {
        ctx.beginPath()
        ctx.arc(legendDot, legendY, 3.5, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.lineWidth = s.dashed ? 1.2 : 1.8
        ctx.setLineDash(s.dashed ? [4, 4] : [])
        ctx.beginPath()
        ctx.moveTo(legendLine, legendY)
        ctx.lineTo(legendLine + 32, legendY)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.fillStyle = COLOR.axisText
      ctx.fillText(s.name, legendText, legendY)
      legendY += 18
    }
  }, [series, xLabel, yLabel, logY, bars, stack, guides])

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
