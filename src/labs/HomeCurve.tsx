import { useEffect, useRef } from 'react'
import { syncCanvasSize } from './canvasSize'
import { homeCurvePoints, phaseAt } from './curvePoints'

// 首页左下角：一条自己慢慢转的三维闭曲线。
// 与右上角的 HomeBackdrop 各自独立——不同 canvas、不同 rAF 循环，互不知道对方存在；
// 组件只读自己的时间参数，不碰任何全局状态。
const NARROW_PX = 1280
const TILT = 0.42
const FOCUS = 4.2
const TEAL = '60, 227, 198'

type Screen = { x: number; y: number; depth: number }

export function HomeCurve() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cosTilt = Math.cos(TILT)
    const sinTilt = Math.sin(TILT)
    let width = 0
    let height = 0
    let frame = 0
    let start = 0

    const measure = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.round(rect.width)
      height = Math.round(rect.height)
    }

    const project = (point: { x: number; y: number; z: number }): Screen => {
      const y1 = point.y * cosTilt - point.z * sinTilt
      const z1 = point.y * sinTilt + point.z * cosTilt
      const depth = FOCUS / (FOCUS + z1 * 0.6)
      const unit = Math.min(width / 3.05, height / 2.45)
      return {
        x: width * 0.46 + point.x * unit * depth,
        y: height * 0.42 - y1 * unit * depth,
        depth,
      }
    }

    const draw = (elapsedMs: number) => {
      if (width < 2 || height < 2) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      // 位图只在尺寸真变时才重分配——直接赋 canvas.width 会把位图每帧清一次。
      if (syncCanvasSize(canvas, width, height, dpr)) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const points = homeCurvePoints(phaseAt(elapsedMs)).map(project)
      ctx.lineCap = 'round'
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        // 远的段淡一点、近的段亮一点，一根线也能看出前后关系。
        const near = Math.min(1, Math.max(0, (b.depth - 0.78) / 0.42))
        ctx.strokeStyle = `rgba(${TEAL}, ${(0.14 + 0.3 * near).toFixed(3)})`
        ctx.lineWidth = 0.9 + 0.7 * near
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    measure()
    const observer = new ResizeObserver(() => {
      measure()
      if (reduced.matches) draw(0)
    })
    observer.observe(canvas)

    if (reduced.matches) {
      // 关掉动效时只留静态一帧，不申请动画帧。
      draw(0)
    } else {
      const tick = (now: number) => {
        if (start === 0) start = now
        if (window.innerWidth >= NARROW_PX) draw(now - start)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }

    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])

  return <canvas ref={ref} className="home-curve" aria-hidden="true" />
}
