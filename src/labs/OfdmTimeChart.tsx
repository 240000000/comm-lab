/**
 * 时域波形图：一个 OFDM 符号（含 CP）在发端长什么样、延时径落进来之后收端看到什么。
 *
 * 三条线：
 * - 实线（青）：发端送出去的数据段，前面那段重复的尾巴就是 CP，用底色圈出来；
 * - 虚线（紫）：延时径落进这个窗口的分量。开头那几位如果来自上一个符号，图上会明显接不上；
 * - 实线（琥珀）：两者相加，收端真正看到的波形。
 *
 * 画的是实部。链路用复基带算，虚部同样存在，只是两条线画在一张图上看不出更多信息。
 */
import { useEffect, useRef } from 'react'

import type { WaveformView } from '../core/ofdm.ts'

const WIDTH = 640
const HEIGHT = 232
const PAD_LEFT = 42
const PAD_RIGHT = 14
const PAD_TOP = 16
const PAD_BOTTOM = 34

const COLOR = {
  grid: '#131c25',
  axis: '#2b4356',
  cpBand: 'rgba(60, 227, 198, 0.07)',
  cpEdge: '#2f5a52',
  dry: '#93a4b8',
  echo: '#8f7fd4',
  received: '#3ce3c6',
  text: '#7f93a8',
  warn: '#ffb054',
}

export function OfdmTimeChart({ wave }: { wave: WaveformView }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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

    const { cpLen, dry, echo, received, intrudingSamples } = wave
    const n = dry.length
    const plotW = WIDTH - PAD_LEFT - PAD_RIGHT
    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM
    const maxAbs = Math.max(...dry.map(Math.abs), ...received.map(Math.abs), 0.6) * 1.15

    const xOf = (i: number) => PAD_LEFT + (i / (n - 1)) * plotW
    const yOf = (v: number) => PAD_TOP + plotH / 2 - (v / maxAbs) * (plotH / 2)

    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // CP 区域底色：横跨前 cpLen 个采样
    if (cpLen > 0) {
      ctx.fillStyle = COLOR.cpBand
      ctx.fillRect(PAD_LEFT, PAD_TOP, xOf(cpLen - 1) - PAD_LEFT + plotW / (n - 1), plotH)
      ctx.strokeStyle = COLOR.cpEdge
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(xOf(cpLen - 1) + plotW / (n - 1), PAD_TOP)
      ctx.lineTo(xOf(cpLen - 1) + plotW / (n - 1), PAD_TOP + plotH)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 零线
    ctx.strokeStyle = COLOR.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, yOf(0))
    ctx.lineTo(WIDTH - PAD_RIGHT, yOf(0))
    ctx.stroke()

    // 延时径分量（虚线）
    ctx.strokeStyle = COLOR.echo
    ctx.lineWidth = 1.4
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = xOf(i)
      const y = yOf(echo[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])

    // 发端输入
    ctx.strokeStyle = COLOR.dry
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = xOf(i)
      const y = yOf(dry[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // 收端收到
    ctx.strokeStyle = COLOR.received
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = xOf(i)
      const y = yOf(received[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // 图上只留一条提示：什么时候拖尾压进了数据段
    ctx.font = '11px Consolas, "Cascadia Mono", monospace'
    ctx.textAlign = 'left'
    if (intrudingSamples > 0) {
      ctx.fillStyle = COLOR.warn
      ctx.fillText(
        `拖尾压进数据段 ${intrudingSamples} 个采样`,
        WIDTH - PAD_RIGHT - ctx.measureText(`拖尾压进数据段 ${intrudingSamples} 个采样`).width,
        PAD_TOP + 11,
      )
    }

    // 横轴
    ctx.strokeStyle = COLOR.axis
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, PAD_TOP + plotH)
    ctx.lineTo(WIDTH - PAD_RIGHT, PAD_TOP + plotH)
    ctx.stroke()

    ctx.fillStyle = COLOR.text
    ctx.textAlign = 'center'
    ctx.fillText(
      cpLen > 0 ? `采样点（0–${cpLen - 1} 是 CP，${cpLen}–${dry.length - 1} 是数据段）` : '采样点（全部是数据段）',
      PAD_LEFT + plotW / 2,
      HEIGHT - 10,
    )
  }, [wave])

  return (
    <figure className="constellation-figure">
      <div className="constellation-frame">
        <canvas
          ref={canvasRef}
          className="constellation"
          role="img"
          aria-label={`一个 OFDM 符号的时域波形：CP 长度 ${wave.cpLen} 个采样，延时径延时 ${wave.delay} 个采样`}
        />
      </div>
      <div className="legend-row" style={{ marginTop: 10 }}>
        <span>
          <i className="legend-dot" style={{ background: '#7f93a8', marginRight: 6 }} />
          发端输入
        </span>
        <span>
          <i className="legend-dot" style={{ background: '#8f7fd4', marginRight: 6 }} />
          延时径落进来的分量
        </span>
        <span>
          <i className="legend-dot" style={{ background: '#3ce3c6', marginRight: 6 }} />
          收端收到
        </span>
        <span>
          <i className="legend-dot" style={{ background: 'rgba(60, 227, 198, 0.25)', marginRight: 6 }} />
          CP 区域
        </span>
      </div>
      <figcaption>
        画的是实部。左侧浅色底是 CP，里面那段重复的尾巴就是数据段末尾的复制；延时不超过 CP 时，
        紫色虚线只落在底色里，数据段是干净的。
      </figcaption>
    </figure>
  )
}
