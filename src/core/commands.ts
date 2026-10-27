/**
 * 本地指令面板的解析器。
 *
 * 这里只有字符串匹配与数字夹紧，没有网络请求、没有模型调用——
 * 面板上那句「本地规则解析，不联网」说的就是这件事。
 *
 * 规则故意做得窄：只认四条真能执行的指令（噪声调大、噪声调小、重跑、重置），
 * 碰到「换阶数」这类暂时做不到的，就老实回一句边界说明，不做假动作。
 */

export type CommandAction = 'snr-up' | 'snr-down' | 'rerun' | 'reset' | 'reject'

export type CommandResult = {
  action: CommandAction
  /** 指令要求的新信噪比（只有 snr-up / snr-down 才有）。 */
  snrDb?: number
  /** 回给用户的一句话，面板上原样显示。 */
  reply: string
}

export type CommandState = {
  snrDb: number
}

/** 信噪比允许范围，与 QAM 页滑块一致。 */
export const SNR_MIN = 0
export const SNR_MAX = 20

const clampSnr = (value: number): number => Math.min(SNR_MAX, Math.max(SNR_MIN, Math.round(value)))

/** 阶数相关的输入：这一页固定 16QAM，认出来就明说，不装能做到。 */
const ORDER_PATTERN = /阶数|调阶|\d+\s*qam|bpsk|qpsk/i

/** 调大噪声 = 降低信噪比？不，这里的「噪声」指信噪比读数：调大对应信噪比往上走。 */
const UP_PATTERN = /调大|大一点|加大|提高|升高|增强|上一点|往上/
const DOWN_PATTERN = /调小|小一点|减小|降低|降一点|减弱|往下/
const NOISE_PATTERN = /噪声|信噪比|snr|db/i
const RERUN_PATTERN = /重跑|再跑|重新跑|再来一次|重算|刷新/
const RESET_PATTERN = /重置|复位|恢复默认|清空|归零/

/**
 * 解析一句指令。
 *
 * 优先级：阶数 → 重置 → 重跑 → 噪声调大/调小 → 认不出来。
 * 每一支都返回一句中文，面板直接把 reply 显示出来。
 */
export function parseCommand(input: string, state: CommandState): CommandResult {
  const text = input.trim()

  if (text === '') {
    return { action: 'reject', reply: '说点什么再发。支持：噪声调大、噪声调小、重跑、重置。' }
  }

  if (ORDER_PATTERN.test(text)) {
    return {
      action: 'reject',
      reply: '这个页现在固定 16QAM，阶数切换还没做——不是没听见，是这一版确实没这个功能。',
    }
  }

  if (RESET_PATTERN.test(text)) {
    return { action: 'reset', reply: '已恢复到默认：16QAM、12 dB、种子 20261027。' }
  }

  if (RERUN_PATTERN.test(text)) {
    return { action: 'rerun', reply: '换一颗种子重跑了一遍，点云和读数都重新算过。' }
  }

  if (NOISE_PATTERN.test(text) && UP_PATTERN.test(text)) {
    const next = clampSnr(state.snrDb + 1)
    return {
      action: 'snr-up',
      snrDb: next,
      reply:
        next === state.snrDb
          ? `已经是上限 ${SNR_MAX} dB，再调大还是 ${SNR_MAX} dB。`
          : `信噪比 ${state.snrDb} → ${next} dB，噪声小了一点。`,
    }
  }

  if (NOISE_PATTERN.test(text) && DOWN_PATTERN.test(text)) {
    const next = clampSnr(state.snrDb - 1)
    return {
      action: 'snr-down',
      snrDb: next,
      reply:
        next === state.snrDb
          ? `已经到底 ${SNR_MIN} dB，再调小还是 ${SNR_MIN} dB。`
          : `信噪比 ${state.snrDb} → ${next} dB，噪声大了一点。`,
    }
  }

  return {
    action: 'reject',
    reply: '这句没听懂。现在只认四条：噪声调大、噪声调小、重跑、重置。',
  }
}
