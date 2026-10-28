/**
 * 原理短片入口与弹层。
 *
 * 三个实验台共用这一个组件，页面只传文件名与片长：
 *   <ShortFilm file="qam-16qam.mp4" seconds={40} />
 * 视频放 public/shorts/，地址用 BASE_URL 拼，线上不会 404。
 *
 * 弹层只放原生 video 与一个关闭叉；不自动播、不调 play()，
 * 打开时把焦点交给叉，关闭时把焦点还给按钮，并把 body 滚动锁住。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortFilmLabel, shortFilmUrl } from '../core/shortFilm'

const MISSING_TEXT = '短片还没放上来，稍后再试'

type Props = {
  /** public/shorts/ 下的文件名，由页面传入。 */
  file: string
  /** 片长（秒），只用来拼按钮文案，不做播放控制。 */
  seconds: number
}

export function ShortFilm({ file, seconds }: Props) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wasOpen = useRef(false)

  const close = () => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    setOpen(false)
  }

  // 打开：锁 body 滚动、把焦点放到叉；关闭：把焦点还给触发按钮。
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) triggerRef.current?.focus()
      return
    }
    wasOpen.current = true
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  // Esc 只在弹层开着时接管，页面平时不抢键。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="short-film-trigger"
        aria-haspopup="dialog"
        onClick={() => {
          setFailed(false)
          setOpen(true)
        }}
      >
        {shortFilmLabel(seconds)}
      </button>

      {open &&
        createPortal(
          <div
            className="short-film-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) close()
            }}
          >
            <div className="short-film-dialog" role="dialog" aria-modal="true" aria-label="原理短片">
              <button
                ref={closeRef}
                type="button"
                className="short-film-close"
                aria-label="关闭短片"
                onClick={close}
              >
                ×
              </button>

              {failed ? (
                <p className="short-film-error" role="alert">
                  {MISSING_TEXT}
                </p>
              ) : (
                <video
                  ref={videoRef}
                  className="short-film-video"
                  src={shortFilmUrl(import.meta.env.BASE_URL, file)}
                  controls
                  playsInline
                  preload="auto"
                  onError={() => setFailed(true)}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
