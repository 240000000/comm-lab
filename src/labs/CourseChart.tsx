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
import { syncCanvasSize } from './canvasSize'
import { chartHeightFor } from './chartHeight'
import { niceTicks } from './niceTicks'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CourseSeries } from '../core/course.ts'

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

// 横轴刻度文字是居中对齐的，最左/最右那根的一半会伸进坐标区外侧的留白里。
// 留白不够时把文字往里挪，宁可离刻度略偏，也不让它被画布边缘切掉。
function clampCenter(ctx: CanvasRenderingContext2D, text: string, center: number, width: number): number {
  const half = ctx.measureText(text).width / 2 + 2
  return Math.min(Math.max(center, half), width - half)
}

export function CourseChart({
  series,
  xLabel,
  yLabel,
  logY = false,
  logX = false,
  bars = false,
  stack = false,
  guides,
  guideLabelAlign = 'left',
  xTicks,
  yTicks,
  markerX,
  markerLabel,
  xRange,
  yRange,
  highlightX,
  label,
}: {
  series: CourseSeries[]
  xLabel: string
  yLabel: string
  logY?: boolean
  logX?: boolean
  bars?: boolean
  stack?: boolean
  guides?: Array<{ y: number; label: string }>
  guideLabelAlign?: 'left' | 'right'
  /** 章节自己指定刻度；传了就用传进来的，不传就走下面的自动算法。 */
  xTicks?: number[]
  yTicks?: number[]
  /** 竖参考线：第 12 章用它指出「当前取的是第几根柱」；不传就没有这条线，其它章零影响。 */
  markerX?: number
  markerLabel?: string
  xRange?: [number, number]
  yRange?: [number, number]
  highlightX?: number
  /** 读屏器读的那句话（chartLabel 拼的）；画布本身对读屏器是空白，必须由外面传进来。 */
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // 宽度只量一次、之后读缓存：clientWidth 会强制浏览器同步重排，
  // 原来每次渲染都在这里读一遍，拖动时就是每帧一次重排。
  const widthRef = useRef(720)
  // 画布高度由宽度现算（chartHeightFor）：宽度一量到就跟着变高，
  // 64 位机和小屏都不至于把一屏图压成一条。state 只管内联 style，
  // 真正画的时候用的是 draw 里按 widthRef 现算的那个 height。
  const [cssHeight, setCssHeight] = useState(() => chartHeightFor(720))

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return

    const width = widthRef.current
    const height = chartHeightFor(width)
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    syncCanvasSize(canvas, width, height, dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
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
    // 章节自己给了纵向刻度时，轴就锁在「刻度下界 → 数据端点」，不再留 8% 的头顶空白：
    // 第 1 章那条竖线的上端点正好落在轴顶，不会多出一截空荡荡的 0.58 bit。
    const yPad = yTicks ? 0 : (yMax - yMin) * (logY ? 0.05 : 0.08)
    yMin -= yPad
    yMax += yPad
    // 数据本身没有负值（比特、误码率、个数），下界就别留负刻度，免得读者以为存在负信息量。
    if (dataMin >= 0) yMin = 0
    // 堆叠柱数的是个数，纵轴下界必须落在 0：否则柱子从负数处往上长，看着像有负计数。
    if (stack) yMin = 0
    // 章节钉死坐标范围（第 10 章 ±0.05、第 12 章 [0,127]）：只在传了的时候覆盖上面算出的自动缩放，
    // 其余 11 章连一个分支都不进。
    if (xRange) {
      xMin = tx(xRange[0])
      xMax = tx(xRange[1])
    }
    if (yRange) {
      yMin = ty(yRange[0])
      yMax = ty(yRange[1])
    }

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
    // 横向刻度值：章节传了就用它给的；堆叠柱的轴是计数，走整数网格；其余线性轴按「好看步长」定网格。
    const xTickList: number[] = []
    if (xTicks) {
      xTickList.push(...xTicks)
    } else if (logX) {
      const step = Math.ceil((xMax - xMin) / 8)
      for (let k = Math.ceil(xMin); k <= Math.floor(xMax); k += step) xTickList.push(k)
    } else if (stack) {
      const step = Math.max(1, Math.round((xMax - xMin) / 8))
      for (let k = Math.ceil(xMin); k <= Math.floor(xMax); k += step) xTickList.push(k)
    } else {
      xTickList.push(...niceTicks(xMin, xMax))
    }
    // 纵向刻度值：同上；没传时线性轴按「好看步长」定网格，对数轴每十倍一档、太密时隔档画。
    const yTickList: number[] = []
    if (yTicks) {
      yTickList.push(...yTicks)
    } else if (logY) {
      const step = Math.ceil((yMax - yMin) / 8)
      for (let k = Math.ceil(yMin); k <= Math.floor(yMax); k += step) yTickList.push(k)
    } else {
      yTickList.push(...niceTicks(yMin, yMax))
    }

    // 网格：竖线跟着横向刻度走，横线跟着纵向刻度走。
    ctx.strokeStyle = COLOR.grid
    ctx.lineWidth = 1
    for (const value of yTickList) {
      const y = PAD.top + (1 - (value - yMin) / (yMax - yMin)) * plotH
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(PAD.left + plotW, y)
      ctx.stroke()
    }
    for (const value of xTickList) {
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

    // 刻度文字：横轴按横向刻度值写（堆叠柱是整数计数）；纵轴按上面算好的刻度值写。
    ctx.fillStyle = COLOR.axisText
    ctx.font = AXIS_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    if (stack) {
      // 堆叠柱的横轴是错误个数，刻度必须是整数；标 0.750 这种小数只会让人以为能拖半位错。
      const step = Math.max(1, Math.round((xMax - xMin) / 8))
      for (let v = Math.ceil(xMin); v <= Math.floor(xMax); v += step) {
        const text = String(v)
        ctx.fillText(text, clampCenter(ctx, text, px(v), width), PAD.top + plotH + 8)
      }
    } else if (logX) {
      for (const value of xTickList) {
        const x = PAD.left + ((value - xMin) / (xMax - xMin)) * plotW
        const text = xTicks ? formatExact(value) : formatPower(value)
        ctx.fillText(text, clampCenter(ctx, text, x, width), PAD.top + plotH + 8)
      }
    } else {
      for (const value of xTickList) {
        const x = PAD.left + ((value - xMin) / (xMax - xMin)) * plotW
        const text = xTicks ? formatExact(value) : formatTick(value)
        ctx.fillText(text, clampCenter(ctx, text, x, width), PAD.top + plotH + 8)
      }
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const value of yTickList) {
      const y = PAD.top + (1 - (value - yMin) / (yMax - yMin)) * plotH
      const text = logY ? formatPower(value) : yTicks ? formatExact(value) : formatTick(value)
      // 刻度文字不许被画布边缘裁掉：留 2 px 余量，宽了就往里挪，不靠改坐标区宽度硬撑。
      const left = PAD.left - 8 - ctx.measureText(text).width
      ctx.fillText(text, left < 2 ? PAD.left - 8 + (2 - left) : PAD.left - 8, y)
    }

    // 轴名。
    ctx.fillStyle = COLOR.label
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(xLabel, PAD.left + plotW / 2, height - 8)
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
        // 上下沿成对出现时只在上沿写字：两条线挨得太近，写两遍会糊成一团。
        if (!g.label) continue
        const right = guideLabelAlign === 'right'
        ctx.textAlign = right ? 'right' : 'left'
        ctx.textBaseline = above ? 'bottom' : 'top'
        // 标注底下垫一层底色：数据点常常正好压在这条线上，不垫就看不清字。
        const labelW = ctx.measureText(g.label).width
        const labelY = above ? gy - 4 : gy + 4
        ctx.fillStyle = 'rgba(9, 15, 22, 0.78)'
        const labelLeft = right ? PAD.left + plotW - labelW - 6 : PAD.left + 3
        ctx.fillRect(labelLeft, above ? labelY - 11 : labelY - 1, labelW + 6, 13)
        ctx.fillStyle = '#8fa7b8'
        ctx.fillText(g.label, right ? PAD.left + plotW - 3 : PAD.left + 6, labelY)
      }
    }

    // 竖参考线：第 12 章拖 τ 时，这条线就是「现在看的是第几根柱」。
    if (markerX !== undefined && Number.isFinite(markerX)) {
      const mx = px(markerX)
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.2
      ctx.strokeStyle = '#e0a45c'
      ctx.beginPath()
      ctx.moveTo(mx, PAD.top)
      ctx.lineTo(mx, PAD.top + plotH)
      ctx.stroke()
      ctx.setLineDash([])
      if (markerLabel) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        const lw = ctx.measureText(markerLabel).width
        // 贴着左右边界时把标签往里挪，否则半个字会画到画布外。
        const cx = Math.min(Math.max(mx, PAD.left + lw / 2 + 3), PAD.left + plotW - lw / 2 - 3)
        ctx.fillStyle = 'rgba(9, 15, 22, 0.78)'
        ctx.fillRect(cx - lw / 2 - 3, PAD.top - 2, lw + 6, 13)
        ctx.fillStyle = '#e0a45c'
        ctx.fillText(markerLabel, cx, PAD.top + 10)
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
          // 顶端点一个实心圆：两根顶到 1 的尖峰相隔 N，靠圆点才数得清是哪两根。
          ctx.beginPath()
          ctx.arc(px(x), tip, 2.1, 0, Math.PI * 2)
          ctx.fillStyle = s.color
          ctx.fill()
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
      // 当前那一档要能被一眼挑出来：别的柱压到 28% 透明度，选中的那根描一圈边框。
      const focus = highlightX !== undefined && Number.isFinite(highlightX) ? highlightX : undefined
      for (const x of xs) {
        const onFocus = focus === undefined || Math.abs(x - focus) < 1e-9
        ctx.globalAlpha = onFocus ? 1 : 0.28
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
          const barH = Math.max(3, Math.abs(y0 - y1))
          ctx.fillRect(px(x) - barW / 2, Math.min(y0, y1) - (barH - Math.abs(y0 - y1)), barW, barH)
          if (Math.abs(y0 - y1) > 15 && point[1] > 0) {
            ctx.fillStyle = '#08121a'
            ctx.font = AXIS_FONT
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(String(point[1]), px(x), (y0 + y1) / 2)
          }
        }
        if (focus !== undefined && onFocus) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = '#ffd166'
          ctx.lineWidth = 1.6
          ctx.strokeRect(px(x) - barW / 2 - 2, py(acc) - 2, barW + 4, py(0) - py(acc) + 4)
        }
      }
      ctx.globalAlpha = 1
    }

    // 线：每一条各自连点，虚线仍是虚线；迹线淡画，不抢包络；marker 只画点不连线。
    for (const s of series) {
      if (bars || stack) break
      ctx.globalAlpha = s.quiet ? 0.18 : 1
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = s.quiet ? 0.8 : s.bold ? 2.2 : s.name === '解调输出' ? 1.8 : 1.2
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
  }, [series, xLabel, yLabel, logX, logY, bars, stack, guides, guideLabelAlign, xTicks, yTicks, markerX, markerLabel, xRange, yRange, highlightX])

  // 画的时候用的是最新的 draw，所以尺寸回调里不必重建 observer。
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
    draw()
  }, [draw])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const host = canvas.parentElement ?? canvas
    const measure = () => Math.round(canvas.clientWidth || 720)

    // 挂载时先拿真实宽度补画一版；量不到（宽 0）就留 720 那版，
    // 等 observer 回调再补，不会出现空白图。
    const initial = measure()
    if (initial > 0 && initial !== widthRef.current) {
      widthRef.current = initial
      setCssHeight(chartHeightFor(initial))
      drawRef.current()
    }

    const observer = new ResizeObserver(() => {
      const next = measure()
      if (next === widthRef.current) return
      widthRef.current = next
      setCssHeight(chartHeightFor(next))
      drawRef.current()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <canvas
      className="course-canvas"
      ref={ref}
      role="img"
      aria-label={label}
      style={{ height: cssHeight }}
    />
  )
}

/** 章节显式给的刻度按原值写：0.01 就写 0.01，不补零成 0.010。 */
function formatExact(value: number): string {
  return String(Number(value.toFixed(6)))
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
