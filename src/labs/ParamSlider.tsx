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
}: ParamSliderProps) {
  const id = useId()
  const [draft, setDraft] = useState(() => formatValue(value, decimals))
  const focusedRef = useRef(false)
  const pushRaf = useRafValue(onChange)

  // 外部改值（预设档、重置、换章）时把草稿跟上；正在输入时不动它。
  useEffect(() => {
    if (focusedRef.current) return
    setDraft(formatValue(value, decimals))
  }, [value, decimals])

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
          value={value}
          aria-label={`${label} 的滑块`}
          onChange={(event) => pushRaf(Number(event.target.value))}
        />
      ) : null}
      {hint !== undefined ? <span className="control-hint">{hint}</span> : null}
    </div>
  )
}