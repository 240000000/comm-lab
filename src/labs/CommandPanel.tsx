/**
 * 本地指令面板。
 *
 * 只做一件事：把用户敲的一行中文交给 src/core/commands.ts 解析，然后把那句话回显出来。
 * 面板上没有网络请求、没有模型调用，解析规则全在本地、可读可测。
 * 「换阶数」和页面上的选择器走同一个 setOrder，两条路不会各说各话。
 */
import { useState } from 'react'
import { parseCommand } from '../core/commands'

type Props = {
  order: number
  snrDb: number
  onSnrChange: (value: number) => void
  onOrderChange: (value: number) => void
  onRerun: () => void
  onReset: () => void
}

export function CommandPanel({ order, snrDb, onSnrChange, onOrderChange, onRerun, onReset }: Props) {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState<string | null>(null)

  const send = () => {
    const result = parseCommand(input, { snrDb, order })
    setReply(result.reply)

    if (result.action === 'snr-up' || result.action === 'snr-down') {
      if (typeof result.snrDb === 'number') onSnrChange(result.snrDb)
    } else if (result.action === 'order') {
      if (typeof result.order === 'number') onOrderChange(result.order)
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
          placeholder="试试：换成 64QAM / 噪声调大 / 重跑 / 重置"
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
        现在认五条：换阶数（BPSK / QPSK / 16QAM / 64QAM）、噪声调大、噪声调小、重跑、重置。
        换阶数和上面的选择器是同一个开关。
      </p>
    </div>
  )
}
