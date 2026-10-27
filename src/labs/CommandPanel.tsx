/**
 * 本地指令面板。
 *
 * 只做一件事：把用户敲的一行中文交给 src/core/commands.ts 解析，然后把那句话回显出来。
 * 面板上没有网络请求、没有模型调用，解析规则全在本地、可读可测。
 */
import { useState } from 'react'
import { parseCommand } from '../core/commands'

type Props = {
  snrDb: number
  onSnrChange: (value: number) => void
  onRerun: () => void
  onReset: () => void
}

export function CommandPanel({ snrDb, onSnrChange, onRerun, onReset }: Props) {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState<string | null>(null)

  const send = () => {
    const result = parseCommand(input, { snrDb })
    setReply(result.reply)

    if (result.action === 'snr-up' || result.action === 'snr-down') {
      if (typeof result.snrDb === 'number') onSnrChange(result.snrDb)
    } else if (result.action === 'rerun') {
      onRerun()
    } else if (result.action === 'reset') {
      onReset()
    }

    setInput('')
  }

  return (
    <div className="command-panel">
      <span className="control-label">
        指令
        <strong>本地规则解析，不联网、不调模型</strong>
      </span>
      <div className="command-row">
        <input
          type="text"
          value={input}
          placeholder="试试：噪声调大 / 噪声调小 / 重跑 / 重置"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
          aria-label="指令输入"
        />
        <button type="button" onClick={send}>
          执行
        </button>
      </div>
      {reply && <p className="command-reply">{reply}</p>}
      <p className="control-hint">
        现在只认四条：噪声调大、噪声调小、重跑、重置。问「换阶数」会被挡回去——这一版阶数写死 16QAM。
      </p>
    </div>
  )
}
