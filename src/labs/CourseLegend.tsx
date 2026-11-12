/**
 * 画布下方的图例。
 *
 * 以前图例画在 canvas 里面：块宽写死 112 像素、名字右对齐贴着绘图区右沿，
 * 名字一长就往左铺到自己的色块上；半透明底还压在右上角的曲线上。
 * 挪过一回位置没用，因为病根是「画在绘图区内部、宽度写死」。
 * 所以这里改成普通网页元素：一行排不下自动换行，宽度跟着容器走。
 */
import type { CourseSeries } from '../core/course.ts'
import { legendItems } from './legendRows.ts'

export function CourseLegend({ series }: { series: CourseSeries[] }) {
  const items = legendItems(series)
  if (items.length === 0) return null

  return (
    <div className="course-legend">
      {items.map((s) => (
        <span key={s.name} className="legend-item">
          <span
            className={`legend-mark${s.marker ? ' is-dot' : ''}${s.dashed ? ' is-dashed' : ''}`}
            style={{ color: s.color }}
            aria-hidden="true"
          />
          <span className="legend-text">{s.name}</span>
        </span>
      ))}
    </div>
  )
}