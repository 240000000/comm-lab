import { useEffect, useId, useRef, useState } from 'react'
import { useRafValue } from '../hooks/useRafValue'

type ParamSliderProps = {
  /** 参数名，原样显示在标签行左侧 */
  label: string
  value: number
  min: number
  max: number
  step: number
  /** 显示在数值后面的单位，含前导空格，比如 ' dB' */
  unit?: string
  /** 固定小数位（原来写 toFixed(1) 的传 1）；不传就按最短自然写法显示 */
  decimals?: number
  /** 滑块下方的说明文字，原样渲染，不改一个字 */
  hint?: string
  /** control：课程视图与 QAM/Conv 侧栏；bar：OFDM 横栏 */
  layout?: 'control' | 'bar'
  /** 只要数值框不要滑块（OFDM 的统计符号数） */
  withRange?: boolean
  className?: string
  onChange: (value: number) => void
  /** 按住滑块：交给调用方决定拖动期间要不要降频 */
  onDragStart?: () => void
  /** 松开滑块：调用方在这里补一次全精度计算 */
  onDragEnd?: () => void
}

function formatValue(value: number, decimals: number | undefined): string {
  if (decimals !== undefined) return value.toFixed(decimals)
  return String(Number(value.toFixed(6)))
}

export function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  decimals,
  hint,
  layout = 'control',
  withRange = true,
  className,
  onChange,
  onDragStart,
  onDragEnd,
}: ParamSliderProps) {
  const id = useId()
  const [draft, setDraft] = useState(() => formatValue(value, decimals))
  const focusedRef = useRef(false)
  // 拖动期间滑块显示的是自己记下的值，不跟受控 value 来回拉：
  // 回写链是 输入 → rAF 提交 → 父组件重算 → 新 value，重算要十几毫秒，
  // 中间这一帧一旦把 value 写回旧值，thumb 就被拽回去了。
  // 拖动期间滑块由浏览器自己走：这期间一个字节都不往 DOM 里写，
  // 只有 rAF 提交后（松手或每两帧一次）才把受控值追上去。
  const rangeRef = useRef<HTMLInputElement | null>(null)
  const draggingRef = useRef(false)
  const pushRaf = useRafValue(onChange)

  // 外部改值（预设档、重置、换章）时把草稿跟上；正在输入时不动它。
  useEffect(() => {
    if (focusedRef.current) return
    setDraft(formatValue(value, decimals))
  }, [value, decimals])

  // 受控值变了就把 DOM 追上去；拖动期间不写，免得把原生滑块拽回来。
  useEffect(() => {
    const el = rangeRef.current
    if (!el || draggingRef.current) return
    const next = String(value)
    if (el.value !== next) el.value = next
  }, [value])

  const clampSnap = (raw: number): number => {
    const clamped = Math.min(max, Math.max(min, raw))
    const steps = Math.round((clamped - min) / step)
    const snapped = Math.min(max, Math.max(min, min + steps * step))
    return Number(snapped.toFixed(Math.max(6, decimals ?? 6)))
  }

  const commitDraft = () => {
    const text = draft.trim()
    const parsed = text === '' ? Number.NaN : Number(text)
    if (!Number.isFinite(parsed)) {
      setDraft(formatValue(value, decimals))
      return
    }
    const next = clampSnap(parsed)
    setDraft(formatValue(next, decimals))
    if (next !== value) onChange(next)
  }

  const outerClass = [layout === 'bar' ? 'ofdm-bar-item' : 'control', className].filter(Boolean).join(' ')
  const labelClass = layout === 'bar' ? 'ofdm-bar-label' : 'control-label'

  const numberBox = (
    <span className="param-field">
      <input
        className="param-value"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={`${label} 的数值`}
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(event) => {
          focusedRef.current = true
          setDraft(event.target.value)
        }}
        onBlur={() => {
          focusedRef.current = false
          commitDraft()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(formatValue(value, decimals))
            event.currentTarget.blur()
          }
        }}
      />
      {unit ? <span className="param-unit">{unit}</span> : null}
    </span>
  )

  // 松手时把最后的值直接对齐一次：rAF 里那一笔可能还排在队里，
  // 先让父组件的 value 追上，滑块就不会在松手瞬间回跳一下再跳回来。
  const releaseDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const el = rangeRef.current
    if (el) el.value = String(value)
    onDragEnd?.()
  }

  return (
    <div className={outerClass}>
      <div className={labelClass}>
        {withRange ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}
        {numberBox}
      </div>
      {withRange ? (
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          ref={rangeRef}
          defaultValue={value}
          aria-label={`${label} 的滑块`}
          onPointerDown={() => {
            draggingRef.current = true
            onDragStart?.()
          }}
          onChange={(event) => {
            pushRaf(Number(event.target.value))
          }}
          onPointerUp={releaseDrag}
          onPointerCancel={releaseDrag}
          onBlur={releaseDrag}
        />
      ) : null}
      {hint !== undefined ? <span className="control-hint">{hint}</span> : null}
    </div>
  )
}