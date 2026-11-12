import assert from 'node:assert/strict'
import test from 'node:test'
import { COURSE_CHAPTERS, type CourseView } from '../src/core/course.ts'

/**
 * 死滑块的守门测试。
 *
 * 课程视图的每一章都把参数交给 compute，画布按 compute 返回的 series 画。但「参数接上了」
 * 不等于「图上看得出来」：第 8 章的 α 曾经完全不进链路，第 11 章的 errors 只在读数里换
 * 数字、四根柱一直全画。这两类都属于死滑块——用户拖到底，图一动不动。
 *
 * 这条测试对每一章每个声明了 min/max 的数值参数取两端各算一次，比较 series 的逐点差
 * （x 与 y 分别对照该轴的范围），并要求最大差超过该轴范围的 0.5%；bars、guides、markerX、
 * highlightX、xRange/yRange 与读数标签也一并计入，任何一处真的变了就算这条滑块活着。
 *
 * 确实需要保留一个不改图的参数（例如它只改结论文案），在这里按 `章号:参数 key` 显式列名
 * 并写理由——白名单默认是空的。
 */
const DEAD_OK: Record<string, string> = {
  '1:sample': '它只决定第 1 章模拟里抛几次硬币，实测平均信息量在 p=0.5 与 p=0.99 处都直接落在理论值上，估计量本身不随次数变——这一轮不动第 1 章。',
}

const THRESHOLD = 0.005

type Pair = [number, number]

const axisSpan = (points: Pair[], index: 0 | 1) => {
  let lo = Infinity
  let hi = -Infinity
  for (const point of points) {
    lo = Math.min(lo, point[index])
    hi = Math.max(hi, point[index])
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : 0
}

const xSpan = (view: CourseView) => {
  if (view.xRange) return Math.abs(view.xRange[1] - view.xRange[0])
  return axisSpan(
    view.series.flatMap((s) => s.points),
    0,
  )
}

const ySpan = (view: CourseView) => {
  if (view.yRange) return Math.abs(view.yRange[1] - view.yRange[0])
  return axisSpan(
    view.series.flatMap((s) => s.points),
    1,
  )
}

/** 两条 series 之间最大的逐点差，以及结构上是否已经变了。 */
const compareSeries = (left: CourseView, right: CourseView) => {
  if (left.series.length !== right.series.length) return { dx: Infinity, dy: Infinity }
  let dx = 0
  let dy = 0
  for (let i = 0; i < left.series.length; i += 1) {
    const a = left.series[i]
    const b = right.series[i]
    if (a.points.length !== b.points.length) return { dx: Infinity, dy: Infinity }
    for (let k = 0; k < a.points.length; k += 1) {
      dx = Math.max(dx, Math.abs(a.points[k][0] - b.points[k][0]))
      dy = Math.max(dy, Math.abs(a.points[k][1] - b.points[k][1]))
    }
  }
  return { dx, dy }
}

const describe = (left: CourseView, right: CourseView) => {
  const parts: string[] = []
  if (left.series.length !== right.series.length) {
    parts.push(`series 条数 ${left.series.length} → ${right.series.length}`)
  }
  const nameA = left.series.map((s) => s.name).join(' | ')
  const nameB = right.series.map((s) => s.name).join(' | ')
  if (nameA !== nameB) parts.push(`series 名「${nameA}」→「${nameB}」`)
  const guideA = (left.guides ?? []).map((g) => g.y).join(',')
  const guideB = (right.guides ?? []).map((g) => g.y).join(',')
  if (guideA !== guideB) parts.push(`guides ${guideA} → ${guideB}`)
  if (left.markerX !== right.markerX) parts.push(`markerX ${left.markerX} → ${right.markerX}`)
  if (left.highlightX !== right.highlightX) parts.push(`highlightX ${left.highlightX} → ${right.highlightX}`)
  const rangeA = JSON.stringify([left.xRange, left.yRange])
  const rangeB = JSON.stringify([right.xRange, right.yRange])
  if (rangeA !== rangeB) parts.push(`轴范围 ${rangeA} → ${rangeB}`)
  if (left.conclusion !== right.conclusion) parts.push('结论变了')
  const readoutA = left.readouts.map((r) => `${r.label}=${r.value}`).join('; ')
  const readoutB = right.readouts.map((r) => `${r.label}=${r.value}`).join('; ')
  if (readoutA !== readoutB) parts.push('读数变了')
  return parts
}

test('13 章的每个数值滑块拖到两端，图上的东西必须真的变', () => {
  const dead: string[] = []
  let checked = 0
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const defaults = chapter.defaults as Record<string, number>
    for (const param of chapter.params) {
      const id = `${chapter.no}:${param.key}`
      if (DEAD_OK[id]) continue
      if (!(param.key in defaults)) {
        dead.push(`${id} 没有默认值，无法做两端对比`)
        continue
      }
      checked += 1
      // 两个基线：默认档 + 失败预置档。有些参数（第 1 章的采样次数）只在特定 p 上才看得出来，
      // 只测默认档会把它误判成死滑块。
      const baselines: Array<Record<string, number>> = [defaults]
      if (chapter.failPreset) baselines.push({ ...defaults, ...chapter.failPreset })
      let moved = false
      let note = ''
      for (const base of baselines) {
        const low = chapter.compute({ ...base, [param.key]: param.min })
        const high = chapter.compute({ ...base, [param.key]: param.max })
        const xs = Math.max(xSpan(low), xSpan(high))
        const ys = Math.max(ySpan(low), ySpan(high))
        const { dx, dy } = compareSeries(low, high)
        if (dy > ys * THRESHOLD || dx > xs * THRESHOLD || describe(low, high).length > 0) {
          moved = true
          break
        }
        note =
          `最大 y 差 ${dy.toExponential(2)}（轴范围 ${ys.toFixed(3)} 的 ${((dy / (ys || 1)) * 100).toFixed(3)}%）、` +
          `最大 x 差 ${dx.toExponential(2)}`
      }
      if (!moved) {
        dead.push(`第 ${chapter.no} 章参数 ${param.key}（${param.min}…${param.max}）拖到底图不动：${note}`)
      }
    }
  }
  // 当前 13 章一共 39 个数值滑块；低于这个数说明参数表被删窄了（R95 时为 39）。
  assert.ok(checked >= 35, `只检查了 ${checked} 个滑块，参数表可能被改窄了`)
  assert.deepEqual(dead, [], `发现 ${dead.length} 个死滑块：\n${dead.join('\n')}`)
})

test('白名单里的每一格里都有理由', () => {
  for (const [id, reason] of Object.entries(DEAD_OK)) {
    assert.ok(reason.trim().length >= 8, `${id} 的理由太短`)
  }
})