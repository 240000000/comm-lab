import { useEffect, useRef } from 'react'
import { syncCanvasSize } from './canvasSize'
import { EYE_SAMPLES, EYE_TRACES, eyePoints } from './eyePoints'

// 首页整页那一层：两团三维眼图瀑布的粒子云，粒子只落在左下与右下，中间整片让给卡片。
//
// 取点全在 eyePoints.ts 里一次算好（Float32Array），这里逐帧只做三件事：
// 绕竖轴转一下、投影到屏幕上、再按深度从远到近铺点。没有 3D 库，也没有每帧 new。
const NARROW_PX = 1280
/** 60 条迹 × 100 列 = 6000 个点。隔一列取一列正好 3000，窄屏再减半。 */
const STRIDE_WIDE = 2
const STRIDE_NARROW = 4
const MAX_PARTICLES = 3000
/** 俯角与透视焦距：z 方向按这个比例折进屏幕纵向，远小近大。 */
const TILT = 0.42
const FOCUS = 3.4
/** 深度分层的档数：一帧只换 12 次颜色，比逐点设 fillStyle 快，也比每帧 sort 省。 */
const BUCKETS = 12
/** 投影后深度的有效区间，用来把远近映射到档位、大小与透明度。 */
const NEAR_MIN = 0.80
const NEAR_MAX = 1.26
/** 紫罗兰色，与右上角星座的青色分得开——那是另一样东西。 */
const VIOLET = '176, 148, 255'

const bucketColor = (b: number): string => {
  const t = b / (BUCKETS - 1)
  return `rgba(${VIOLET}, ${(0.045 + 0.8 * t).toFixed(3)})`
}

export function HomeParticles() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cloud = eyePoints()
    const half = EYE_TRACES / 2
    const sx = new Float32Array(MAX_PARTICLES)
    const sy = new Float32Array(MAX_PARTICLES)
    const halfSize = new Float32Array(MAX_PARTICLES)
    const bucket = new Uint8Array(MAX_PARTICLES)
    const colors = new Array<string>(BUCKETS)
    for (let b = 0; b < BUCKETS; b += 1) colors[b] = bucketColor(b)

    let width = 0
    let height = 0
    let frame = 0
    let start = 0

    const measure = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.round(rect.width)
      height = Math.round(rect.height)
    }

    const draw = (elapsedMs: number) => {
      if (width < 2 || height < 2) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      // 位图只在尺寸真变时才重分配——直接赋 canvas.width 会把位图每帧清一次（R52）。
      if (syncCanvasSize(canvas, width, height, dpr)) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const stride = window.innerWidth >= NARROW_PX ? STRIDE_WIDE : STRIDE_NARROW
      const spin = (elapsedMs / 14000) * Math.PI * 2
      let count = 0

      for (let zone = 0; zone < 2; zone += 1) {
        // 两团反向转：左边顺时针、右边逆时针，中间才不会连成一片糊。
        const ang = zone === 0 ? spin : -spin + Math.PI
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const cx = width * (zone === 0 ? 0.17 : 0.83)
        const cy = height - 175
        const unit = Math.min(Math.max(width * 0.135, 150), 300)

        for (let trace = zone * half; trace < (zone + 1) * half; trace += 1) {
          const rowBase = trace * EYE_SAMPLES * 3
          for (let sample = 0; sample < EYE_SAMPLES; sample += stride) {
            const at = rowBase + sample * 3
            const x = cloud[at]
            const y = cloud[at + 1]
            const z = cloud[at + 2]
            const rx = x * ca - z * sa
            const rz = x * sa + z * ca
            const depth = FOCUS / (FOCUS + rz * 0.55)
            sx[count] = cx + rx * unit * depth
            sy[count] = cy - (y * unit * 0.55 + rz * unit * TILT) * depth
            const level = Math.min(1, Math.max(0, (depth - NEAR_MIN) / (NEAR_MAX - NEAR_MIN)))
            halfSize[count] = 0.45 + 1.15 * level
            bucket[count] = Math.min(BUCKETS - 1, Math.floor(level * BUCKETS))
            count += 1
          }
        }
      }

      // 从最远的一档铺到最近的一档：远的小、暗，近的大、亮。
      for (let b = 0; b < BUCKETS; b += 1) {
        ctx.fillStyle = colors[b]
        for (let i = 0; i < count; i += 1) {
          if (bucket[i] !== b) continue
          const s = halfSize[i]
          ctx.fillRect(sx[i] - s, sy[i] - s, s * 2, s * 2)
        }
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
        draw(now - start)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }

    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])

  return <canvas ref={ref} className="home-particles" aria-hidden="true" />
}
