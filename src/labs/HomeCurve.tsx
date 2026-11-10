import { useEffect, useRef } from 'react'
import { syncCanvasSize } from './canvasSize'
import { SPIRAL_RADIUS, SPIRAL_SPAN, homeCurvePoints, phaseAt } from './curvePoints'

// 首页左下角：一条绕竖轴慢慢自转的三维螺旋，填在页面左侧的留白里。
// 与右上角的 HomeBackdrop 各自独立——不同 canvas、不同 rAF 循环，互不知道对方存在；
// 组件只读自己的时间参数，不碰任何全局状态。
const NARROW_PX = 1280
/** 俯角：z 方向的分量按这个比例换到屏幕纵向，螺旋才有前后错落。 */
const TILT = 0.5
const FOCUS = 3.6
/** 紫罗兰色，与右上角星座的青色分得开——那是另一样东西。 */
const VIOLET = '176, 148, 255'

type Screen = { x: number; y: number; depth: number }

export function HomeCurve() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
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
      // 竖条带的高度远大于宽度：横向按直径铺满，纵向按落程铺满，各自归一。
      const unitX = (width * 0.4) / SPIRAL_RADIUS
      const unitY = (height * 0.46) / (SPIRAL_SPAN / 2)
      const depth = FOCUS / (FOCUS + point.z * 0.6)
      return {
        x: width / 2 + point.x * unitX * depth,
        y: height / 2 - (point.y * unitY - point.z * unitX * TILT),
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
        const near = Math.min(1, Math.max(0, (b.depth - 0.82) / 0.36))
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        // 外发光：同样一笔再描宽一点、压暗一点，先铺在底下。
        ctx.strokeStyle = `rgba(${VIOLET}, ${(0.05 + 0.09 * near).toFixed(3)})`
        ctx.lineWidth = 3.4
        ctx.stroke()
        ctx.strokeStyle = `rgba(${VIOLET}, ${(0.24 + 0.58 * near).toFixed(3)})`
        ctx.lineWidth = 1.0 + 0.8 * near
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
