import { useEffect, useRef } from 'react'
import { syncCanvasSize } from './canvasSize'
import { EYE_SAMPLES, EYE_TRACES, eyePoints } from './eyePoints'
import { formAt } from './formCycle'
import { spectrumPoints } from './spectrumPoints'

// 首页整页那一层：两团三维粒子云，粒子只落在左下与右下，中间整片让给卡片。
//
// 同一批粒子在两个形态之间循环变形（R78）：形态 A 是眼图瀑布、形态 B 是一叠频谱。
// 两套点阵在 eyePoints.ts / spectrumPoints.ts 里各算一次，且用的是同一张网格
// （同 trace、同 sample、同 x、同 z），所以下标 i 在两个形态里都指同一个粒子。
// 这里逐帧只做四件事：按下标插值、绕竖轴转、投影、按深度从远到近铺点。
// 没有 3D 库，也没有每帧 new。
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
    // 两套点阵各算一次，之后逐帧只读不建；挡住全部 60 条迹的还是一套点阵。
    const eye = eyePoints()
    const spectrum = spectrumPoints()
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

      // 形态循环：w 是「离形态 B 有多近」，停 A 时 0、停 B 时 1、变形中按 smoothstep 走。
      const form = formAt(elapsedMs)
      const toB = form.to === 'spectrum'
      const fromB = form.from === 'spectrum'
      const w = toB ? (fromB ? 1 : form.t) : fromB ? 1 - form.t : 0
      const wa = 1 - w

      const stride = window.innerWidth >= NARROW_PX ? STRIDE_WIDE : STRIDE_NARROW
      const spin = (elapsedMs / 14000) * Math.PI * 2
      let count = 0

      // 只画一团：摆在左下 0.17 处、顺时针转。变形过程中这一层照常转——
      // 旋转与形态插值两件事迭加，不是二选一。右半区留空，给 hero 与说明让位。
      const ang = spin
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      const cx = width * 0.17
      const cy = height - 175
      const unit = Math.min(Math.max(width * 0.135, 150), 300)

      for (let trace = 0; trace < EYE_TRACES; trace += 1) {
        const rowBase = trace * EYE_SAMPLES * 3
        for (let sample = 0; sample < EYE_SAMPLES; sample += stride) {
          const at = rowBase + sample * 3
          // 同一个下标在两个形态里都有定义，所以这里只是两支线性组合，不新建数组。
          const x = eye[at] * wa + spectrum[at] * w
          const y = eye[at + 1] * wa + spectrum[at + 1] * w
          const z = eye[at + 2] * wa + spectrum[at + 2] * w
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
      // 关掉动效时只画形态 A 的静态一帧：不循环、不申请动画帧。
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
