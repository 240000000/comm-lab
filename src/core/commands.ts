/**
 * 本地指令面板的解析器。
 *
 * 这里只有字符串匹配与数字夹紧，没有网络请求、没有模型调用——
 * 面板上那句「本地规则解析，不联网」说的就是这件事。
 *
 * 现在有五条真能执行的指令：换阶数、噪声调大、噪声调小、重跑、重置。
 * 换阶数会返回目标阶数，页面拿着它去改选择器，和手动点按钮走同一条路；
 * 认不出、或者要一档没有的（比如 256QAM），就老实回一句边界说明，不做假动作。
 */
import { QAM_ORDERS, bitsPerSymbol, orderLabel } from './qam.ts'

export type CommandAction = 'snr-up' | 'snr-down' | 'rerun' | 'reset' | 'order' | 'reject'

export type CommandResult = {
  action: CommandAction
  /** 指令要求的新信噪比（只有 snr-up / snr-down 才有）。 */
  snrDb?: number
  /** 指令要求切换到的阶数（只有 order 才有）。 */
  order?: number
  /** 回给用户的一句话，面板上原样显示。 */
  reply: string
}

export type CommandState = {
  snrDb: number
  /** 当前阶数，用来判断「已经是这一档」。 */
  order: number
}

/** 信噪比允许范围，与 QAM 页滑块一致。 */
export const SNR_MIN = 0
export const SNR_MAX = 20

const clampSnr = (value: number): number => Math.min(SNR_MAX, Math.max(SNR_MIN, Math.round(value)))

/** 界面上一句话能说清的四档，顺序与 QAM 页选择器一致。 */
const OPTIONS_TEXT = QAM_ORDERS.map((order) => orderLabel(order)).join('、')
const SUPPORTED_ORDERS: readonly number[] = QAM_ORDERS

/** 只提到「阶数」相关词，就能确定这句话是在说阶数。 */
const ORDER_WORD = /阶数|调阶|qam|bpsk|qpsk/i
/** 「换成 64」这种动词加数字，也是换阶数。 */
const ORDER_VERB_NUMBER = /(?:换成|换到|切到|切换到|改到|改成|调到|调成|用)\s*(?:到|成)?\s*\d+/
/** 只敲一个数字也认：64 → 64QAM。 */
const BARE_ORDER_NUMBER = /^\s*\d+\s*$/
/** 带这些词的句子交给噪声那一条，别把「改成 12 dB」当成换阶数。 */
const NOISE_WORD = /噪声|信噪比|snr|db|分贝/i

/** 调大噪声 = 降低信噪比？不，这里的「噪声」指信噪比读数：调大对应信噪比往上走。 */
const UP_PATTERN = /调大|大一点|加大|提高|升高|增强|上一点|往上/
const DOWN_PATTERN = /调小|小一点|减小|降低|降一点|减弱|往下/
const NOISE_PATTERN = /噪声|信噪比|snr|db/i
const RERUN_PATTERN = /重跑|再跑|重新跑|再来一次|重算|刷新/
const RESET_PATTERN = /重置|复位|恢复默认|清空|归零/

/**
 * 从一句话里认出要换到哪一档；认不出返回 null。
 *
 * 数字写法覆盖四种常见说法：换到 64、64QAM、QPSK、只敲一个 64。
 * 认出来但不在四档里的（256QAM），由调用方回「没有这一档」。
 */
function readOrderTarget(text: string): number | null {
  if (/bpsk/i.test(text)) return 2
  if (/qpsk/i.test(text)) return 4

  const withQam = text.match(/(\d+)\s*(?:-)?\s*qam/i)
  if (withQam) return Number(withQam[1])

  const withVerb = text.match(
    /(?:阶数|调阶|切换到|切换|换到|换成|改到|改成|调到|调成|切到|用)\s*(?:到|成)?\s*(\d+)/,
  )
  if (withVerb) return Number(withVerb[1])

  if (BARE_ORDER_NUMBER.test(text)) return Number(text.trim())
  return null
}

/**
 * 解析一句指令。
 *
 * 优先级：换阶数 → 重置 → 重跑 → 噪声调大/调小 → 认不出来。
 * 每一支都返回一句中文，面板直接把 reply 显示出来。
 */
export function parseCommand(input: string, state: CommandState): CommandResult {
  const text = input.trim()

  if (text === '') {
    return {
      action: 'reject',
      reply: '说点什么再发。支持：换阶数、噪声调大、噪声调小、重跑、重置。',
    }
  }

  const wantsOrder = ORDER_WORD.test(text) || ORDER_VERB_NUMBER.test(text) || BARE_ORDER_NUMBER.test(text)
  if (wantsOrder && (ORDER_WORD.test(text) || !NOISE_WORD.test(text))) {
    const target = readOrderTarget(text)
    if (target === null) {
      return { action: 'reject', reply: `要换到哪一档？现在能换 ${OPTIONS_TEXT}。` }
    }
    if (!SUPPORTED_ORDERS.includes(target)) {
      return {
        action: 'reject',
        reply: `只支持 ${OPTIONS_TEXT} 四档，${target}QAM 这一版没有。`,
      }
    }
    if (target === state.order) {
      return {
        action: 'order',
        order: target,
        reply: `现在就是 ${orderLabel(target)}（每符号 ${bitsPerSymbol(target)} 比特），没有变。`,
      }
    }
    return {
      action: 'order',
      order: target,
      reply: `已切到 ${orderLabel(target)}：${target} 个星座点、每符号 ${bitsPerSymbol(target)} 比特，点云、三个读数和 0–20 dB 曲线都按新阶数重算过了。`,
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
    reply: '这句没听懂。现在认五条：换阶数、噪声调大、噪声调小、重跑、重置。',
  }
}
