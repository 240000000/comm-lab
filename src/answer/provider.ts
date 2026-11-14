/**
 * 答题模式的模型层接口。
 *
 * 这一轮只写接口与被禁用的默认实现：仓库里不带任何 key，也不在后端跑推理。
 * 想要接真模型，就在 `.env.local` 里配 `VITE_ANSWER_ENDPOINT`（不提交），
 * 由它返回 AnswerResult 形状的 JSON；没配就老实显示「演示模式」。
 */

/** 答案里可被滑块复用的参数，值一定是数字，单位/含义放在 label 里。 */
export type AnswerParam = { key: string; label: string; value: number }

/** 一次回答的结构：先给结论，再给关键步骤，最后是可选提醒。 */
export type AnswerResult = {
  headline: string
  steps: string[]
  params: AnswerParam[]
  caveat?: string
}

/** 没接模型时的返回：调用方据此切到内置题库，并且必须显示「演示模式」。 */
export type AnswerOffline = { status: 'offline' }

export type AnswerProvider = (input: {
  text: string
  topicId: number
}) => Promise<AnswerResult | AnswerOffline>

/** 读构建期变量；Node 下（测试）没有 import.meta.env，取不到就当没配。 */
function endpoint(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env
  return (env?.VITE_ANSWER_ENDPOINT ?? '').trim()
}

/** 配置了端点才发请求，端点返回的必须是 AnswerResult。 */
export const remoteProvider: AnswerProvider = async (input) => {
  const url = endpoint()
  if (!url) return { status: 'offline' }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(`模型端点返回 ${response.status}`)
  return (await response.json()) as AnswerResult
}

/**
 * 默认实现：没配端点就返回 offline，绝不假装答过。
 * UI 拿到 offline 会改从内置题库取答案，并在卡片上写明「演示模式」。
 */
export const defaultProvider: AnswerProvider = async (input) => {
  if (!endpoint()) return { status: 'offline' }
  return remoteProvider(input)
}

/** 当前是否接了真模型（只影响提示文案）。 */
export function hasModelEndpoint(): boolean {
  return endpoint() !== ''
}