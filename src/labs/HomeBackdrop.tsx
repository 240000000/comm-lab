import { useEffect, useRef } from 'react'

// 首页背景：16QAM 的 4×4 星座在三维里绕 Y 轴转，周期性地被噪声推散、再收回。
// 只画在首页；其他页面根本不挂载，所以离开路由时 canvas 与动画循环一起消失。
const CYCLE_MS = 14000
const TEAL: [number, number, number] = [60, 227, 198]
const AMBER: [number, number, number] = [240, 163, 94]
const BG = 'rgba(11, 15, 20, '

type Particle = {
  ox: number
  oy: number
  oz: number
  sx: number
  sy: number
  sz: number
  phase: number
  speed: number
  size: number
  alpha: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function smooth(t: number) {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

// 一个周期：网格静置 4.2s → 散开 2.2s → 云里停 2.4s → 收回 2.6s。
function scatterAt(t: number) {
  const u = ((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS / CYCLE_MS
  if (u < 0.3) return 0
  if (u < 0.46) return smooth((u - 0.3) / 0.16)
  if (u < 0.62) return 1
  if (u < 0.8) return 1 - smooth((u - 0.62) / 0.18)
  return 0
}

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ] as const
}

export function HomeBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let start = 0
    let last = 0
    let particles: Particle[] = []
    let scrim: CanvasGradient | null = null
    let quality = 0
    let lowSeconds = 0
    let frames = 0
    let fpsAt = 0
    let warmupUntil = 0
    let stopped = false
    let timer = 0

    const makeParticles = () => {
      const rnd = mulberry32(20261028)
      const count = width < 1024 ? 600 : 1200
      const list: Particle[] = []
      for (let i = 0; i < count; i++) {
        const col = Math.floor(rnd() * 4)
        const row = Math.floor(rnd() * 4)
        const theta = rnd() * Math.PI * 2
        const phi = Math.acos(2 * rnd() - 1)
        const radius = 1.0 + rnd() * 1.5
        // 网格期贴着某个星座点，散开期铺成一团球状云。
        const ox = (col - 1.5) * 0.66 + (rnd() - 0.5) * 0.06
        const oy = (1.5 - row) * 0.66 + (rnd() - 0.5) * 0.06
        list.push({
          ox,
          oy,
          oz: (rnd() - 0.5) * 0.1,
          sx: Math.sin(phi) * Math.cos(theta) * radius,
          sy: Math.cos(phi) * radius,
          sz: Math.sin(phi) * Math.sin(theta) * radius,
          phase: rnd() * Math.PI * 2,
          speed: 0.45 + rnd() * 1.1,
          size: 1.1 + rnd() * 1.1,
          alpha: 0.28 + rnd() * 0.28,
        })
      }
      return list
    }

    const resize = () => {
      const box = canvas.parentElement?.getBoundingClientRect()
      width = Math.max(1, box?.width ?? window.innerWidth)
      height = Math.max(1, box?.height ?? window.innerHeight)
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      scrim = ctx.createLinearGradient(0, 0, width * 0.8, 0)
      scrim.addColorStop(0, `${BG}0.78)`)
      scrim.addColorStop(0.58, `${BG}0.52)`)
      scrim.addColorStop(1, `${BG}0.18)`)
      particles = makeParticles()
      quality = 0
      lowSeconds = 0
    }

    const draw = (now: number, s: number) => {
      const t = now - start
      const angle = t * 0.00016
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const f = 4.6
      const unit = Math.min(width * 0.2, height * 0.2)
      const cx = width * (width < 900 ? 0.62 : 0.71)
      const cy = height * 0.24

      ctx.globalAlpha = 1
      ctx.fillStyle = '#0b0f14'
      ctx.fillRect(0, 0, width, height)

      const project = (x: number, y: number, z: number) => {
        const rx = x * cos + z * sin
        const rz = -x * sin + z * cos
        const depth = f / (f - rz)
        return [cx + rx * unit * depth, cy - y * unit * depth, depth] as const
      }

      const active = quality === 0 ? particles.length : Math.floor(particles.length / 2)
      const color = mix(TEAL, AMBER, s)
      const cloudColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, `

      // 网格期给相邻点连一层很淡的线，4×4 的骨架才立得住；散开时线淡出。
      if (s < 0.25) {
        const lineAlpha = 0.11 * (1 - s / 0.25)
        ctx.strokeStyle = `${cloudColor}${lineAlpha.toFixed(3)})`
        ctx.lineWidth = 1
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 4; col++) {
            const [x0, y0] = project((col - 1.5) * 0.66, (1.5 - row) * 0.66, 0)
            if (col < 3) {
              const [x1, y1] = project((col - 0.5) * 0.66, (1.5 - row) * 0.66, 0)
              ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
            }
            if (row < 3) {
              const [x1, y1] = project((col - 1.5) * 0.66, (1.5 - row - 1) * 0.66, 0)
              ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
            }
          }
        }
      }

      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
      for (let i = 0; i < active; i++) {
        const p = particles[i]
        const wobble = Math.sin(t * 0.0012 * p.speed + p.phase) * (0.02 + s * 0.09)
        const x = p.ox * (1 - s) + p.sx * s + wobble
        const y = p.oy * (1 - s) + p.sy * s - wobble * 0.7
        const z = p.oz * (1 - s) + p.sz * s
        const [px, py, depth] = project(x, y, z)
        if (px < -20 || px > width + 20 || py < -20 || py > height + 20) continue
        const size = p.size * depth * (0.9 + 0.4 * s)
        ctx.globalAlpha = p.alpha * (0.45 + 0.55 * s)
        ctx.fillRect(px - size / 2, py - size / 2, size, size)
      }
      ctx.globalAlpha = 1

      // 16 个星座点：网格期是干净的 4×4，散开期被推到球面上。
      const rnd = mulberry32(20261029)
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const gx = (col - 1.5) * 0.66
          const gy = (1.5 - row) * 0.66
          const theta = Math.round(rnd() * 1000) / 1000 * Math.PI * 2
          const phi = Math.acos(2 * rnd() - 1)
          const radius = 1.1 + rnd() * 1.0
          const x = gx * (1 - s) + Math.sin(phi) * Math.cos(theta) * radius * s
          const y = gy * (1 - s) + Math.cos(phi) * radius * s
          const z = Math.sin(phi) * Math.sin(theta) * radius * s
          const [px, py, depth] = project(x, y, z)
          const size = 3.2 * depth
          ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
          ctx.globalAlpha = 0.14
          ctx.beginPath()
          ctx.arc(px, py, 13 * depth, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 0.95
          ctx.beginPath()
          ctx.arc(px, py, size, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // 整体压暗，左侧标题区再压一层，保证标题压得住背景。
      ctx.globalAlpha = 1
      if (!scrim) return
      ctx.fillStyle = scrim
      ctx.fillRect(0, 0, width, height)
    }

    const drawStatic = () => {
      draw(performance.now(), 0)
    }

    const loop = (now: number) => {
      if (stopped) return
      if (!last) last = now
      if (!fpsAt) fpsAt = now
      if (now > warmupUntil) {
        frames++
        if (now - fpsAt >= 1000) {
          const fps = (frames * 1000) / (now - fpsAt)
          if (fps < 45) lowSeconds++
          else lowSeconds = 0
          if (lowSeconds >= 2) {
            if (quality === 0) {
              quality = 1
              lowSeconds = 0
            } else {
              stopped = true
              draw(now, scatterAt(now - start))
              return
            }
          }
          frames = 0
          fpsAt = now
        }
      }
      draw(now, scatterAt(now - start))
      last = now
      raf = window.requestAnimationFrame(loop)
    }

    const stop = () => {
      stopped = true
      window.cancelAnimationFrame(raf)
    }

    const startLoop = () => {
      if (stopped) return
      raf = window.requestAnimationFrame(loop)
    }

    const restart = () => {
      stop()
      stopped = false
      last = 0
      fpsAt = 0
      frames = 0
      lowSeconds = 0
      startLoop()
    }

    const onVisibility = () => {
      if (reduced.matches || stopped) return
      if (document.hidden) {
        stop()
      } else {
        restart()
      }
    }

    const onReduced = () => {
      stop()
      if (reduced.matches) {
        drawStatic()
      } else {
        stopped = false
        start = performance.now()
        warmupUntil = start + 1500
        restart()
      }
    }

    const observer = new ResizeObserver(() => {
      resize()
      if (reduced.matches || stopped) drawStatic()
    })
    observer.observe(canvas.parentElement ?? canvas)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', onReduced)

    resize()
    start = performance.now()
    warmupUntil = start + 1500
    fpsAt = 0

    if (reduced.matches) {
      drawStatic()
    } else {
      // 先让首屏内容完成一帧，再启动背景，避免画布抢首帧。
      timer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(loop)
      }, 80)
    }

    return () => {
      window.clearTimeout(timer)
      stop()
      observer.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', onReduced)
    }
  }, [])

  return <canvas ref={ref} className="home-backdrop" aria-hidden="true" />
}
