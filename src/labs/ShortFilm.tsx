/**
 * 原理短片入口与弹层。
 *
 * 三个实验台共用这一个组件，页面传文件名、海报名与片长：
 *   <ShortFilm file="qam-16qam.mp4" poster="qam-poster.jpg" seconds={42} />
 * 视频与海报都放 public/shorts/，地址用 BASE_URL 拼，线上不会 404。
 *
 * 弹层只放原生 video 与一个关闭叉；不自动播、不调 play()，
 * 打开时把焦点交给叉，关闭时把焦点还给按钮，并把 body 滚动锁住。
 * 视频只在弹层打开时挂载并 load()，打开期间用 CSS 转圈表示加载/缓冲。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortFilmLabel, shortFilmUrl } from '../core/shortFilm'

const MISSING_TEXT = '短片还没放上来，稍后再试'

type Props = {
  /** public/shorts/ 下的视频文件名，由页面传入。 */
  file: string
  /** public/shorts/ 下的海报文件名，由页面传入。 */
  poster: string
  /** 片长（秒），只用来拼按钮文案，不做播放控制。 */
  seconds: number
}

export function ShortFilm({ file, poster, seconds }: Props) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wasOpen = useRef(false)

  const base = import.meta.env.BASE_URL
  const videoUrl = shortFilmUrl(base, file)
  const posterUrl = shortFilmUrl(base, poster)

  const close = () => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    setLoading(true)
    setReady(false)
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

  // 视频元素随弹层挂载，这里显式 load()：打开前不预载，打开后才开始取流。
  useEffect(() => {
    if (!open) return
    videoRef.current?.load()
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
          setLoading(true)
          setReady(false)
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
                <div className="short-film-stage">
                  <video
                    ref={videoRef}
                    className="short-film-video"
                    src={videoUrl}
                    poster={ready ? undefined : posterUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onCanPlay={() => {
                      setLoading(false)
                      setReady(true)
                      const video = videoRef.current
                      // 暂停在 0 时部分浏览器不绘制首帧，轻推 10 ms 让画面出来；
                      // 时间轴仍显示 0:00，关闭时照旧回到 0。
                      if (video && video.currentTime === 0) video.currentTime = 0.01
                    }}
                    onPlaying={() => {
                      setLoading(false)
                      setReady(true)
                    }}
                    onWaiting={() => setLoading(true)}
                    onPause={() => setLoading(false)}
                    onError={() => {
                      setFailed(true)
                      setLoading(false)
                    }}
                  />
                  {loading && (
                    <div className="short-film-spinner" role="status" aria-label="短片加载中" />
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
