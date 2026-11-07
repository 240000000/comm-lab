import { useCallback, useEffect, useRef } from 'react'

/**
 * 把高频的 input 事件合到每帧一次。
 *
 * 拖动滑块时浏览器每动一像素就发一次 input 事件，若每次都 setState，
 * 一次仿真加六张图会在一帧里重算好几遍。这里只把最新值记进 ref，
 * 用 requestAnimationFrame 等下一帧再提交一次：同一帧内来多少事件都只算一遍。
 */
export function useRafValue(commit: (value: number) => void) {
  const latest = useRef<number | null>(null)
  const frame = useRef(0)
  const commitRef = useRef(commit)

  useEffect(() => {
    commitRef.current = commit
  }, [commit])

  useEffect(() => {
    return () => {
      if (frame.current !== 0) {
        cancelAnimationFrame(frame.current)
        frame.current = 0
      }
    }
  }, [])

  return useCallback((value: number) => {
    latest.current = value
    if (frame.current !== 0) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const next = latest.current
      latest.current = null
      if (next === null) return
      commitRef.current(next)
    })
  }, [])
}