/**
 * 答题模式的模型层。
 *
 * 这一版把「题目截图」直接发给模型：OpenAI 兼容的多模态消息，
 * user 里是 image_url（data:image/png;base64,...）+ 一句文字指令，
 * 系统提示要求模型只回 JSON。模型自己看图、自己读题、自己给答案，
 * 不再依赖 tesseract 的识别结果（OCR 只留给没有端点时的离线模式）。
 *
 * 端点地址不写死在代码里：运行时读 `public/answer-config.json`，
 * 里面只有 `{ "endpoint": "...", "model": "..." }` 这类不含密钥的配置；
 * key 放在同源的转发层（或本机代理）里，仓库里绝不能出现。
 * 没有配置端点时返回 `{ status: 'offline' }`，界面走离线三题。
 */

/** 等模型的上限：超过这个时间就明说「这次没答上来」，不让人对着转圈猜。 */
export const MODEL_TIMEOUT_MS = 20_000

/** 答案里可被滑块复用的参数，值一定是数字，单位/含义放在 label 里。 */
export type AnswerParam = { key: string; label: string; value: number }

/** 右栏该用哪组参数：`no` 是章节号，`values` 直接盖到该章 defaults 上。 */
export type AnswerPreset = { no: number; values: Record<string, number> }

/** 一次回答的结构：先给结论，再给关键步骤，最后是可选提醒。 */
export type AnswerResult = {
  headline: string
  steps: string[]
  params: AnswerParam[]
  caveat?: string
  /** 可选的「本屏参数」：有它就让右栏与左栏用同一组数 */
  preset?: AnswerPreset
}

/** 模型作答时附带的元信息，界面上标出来，避免看起来像本地算的。 */
export type AnswerMeta = {
  model?: string
  /** 从发请求到拿到结果，毫秒 */
  ms?: number
  promptTokens?: number
  completionTokens?: number
  /** 模型自报的置信度 0–1 */
  confidence?: number
  /** 模型判断的章节号 */
  chapter?: number
  /** 模型直接读图得到的题面 */
  transcript?: string
}

export type AnswerOk = AnswerResult & { status: 'ok'; meta: AnswerMeta }
/** 没接模型时的返回：调用方据此切到内置题库，并且必须显示「演示模式」。 */
export type AnswerOffline = { status: 'offline' }
/** 接了模型但这次失败：调用方必须报错，不许拿内置答案冒充。 */
export type AnswerError = { status: 'error'; message: string }
export type AnswerReply = AnswerOk | AnswerOffline | AnswerError

export type AnswerRequest = {
  /** 原图，直接发给多模态模型 */
  image: Blob
  /** 本机识别的题面（离线模式用；在线时只作为提示的补充） */
  text: string
  /** 定位到的章节号，0 表示没定位到 */
  topicId: number
}

export type AnswerProvider = (request: AnswerRequest) => Promise<AnswerReply>

/** 配置文件放在 public/ 下，构建后与原页面同源。 */
export const ANSWER_CONFIG_FILE = 'answer-config.json'

type AnswerConfig = { endpoint?: string; model?: string }

let configPromise: Promise<AnswerConfig | null> | null = null

/** 读一次配置就记住；读不到（404、JSON 坏了、没网络）就当没配。 */
function loadConfig(): Promise<AnswerConfig | null> {
  if (configPromise) return configPromise
  configPromise = (async () => {
    if (typeof document === 'undefined') return null
    try {
      const url = new URL(ANSWER_CONFIG_FILE, document.baseURI).href
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) return null
      const raw = (await response.json()) as AnswerConfig
      return raw && typeof raw === 'object' ? raw : null
    } catch {
      return null
    }
  })()
  return configPromise
}

/** 环境变量兜底：本地调试时可以用 .env.local 里的 VITE_ANSWER_ENDPOINT。 */
function envEndpoint(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  return (env?.VITE_ANSWER_ENDPOINT ?? '').trim()
}

/** 当前是否有可用的模型端点（配置文件或环境变量任一）。 */
export async function resolveEndpoint(): Promise<{ endpoint: string; model?: string } | null> {
  const config = await loadConfig()
  const endpoint = (config?.endpoint ?? '').trim() || envEndpoint()
  if (!endpoint) return null
  return { endpoint, model: config?.model }
}

export function hasModelEndpoint(): Promise<boolean> {
  return resolveEndpoint().then((found) => found !== null)
}

const SYSTEM_PROMPT = [
  '你是通信原理课程的助教。用户给你一张题目截图，你要看图做题。',
  '只输出一个 JSON 对象，不要输出 Markdown 代码块、不要输出解释性的前后缀文字。',
  'JSON 字段：',
  '  transcript: 你从图里读到的题面原文（字符串）；',
  '  headline: 一句话结论，形如「信道容量 C ≈ 29.9 kbit/s」（字符串）；',
  '  answer: 最终答案的简要写法（字符串，与 headline 一致即可）；',
  '  steps: 推导步骤数组（字符串数组，3–6 条，每条一句）；',
  '  params: 数值参数数组，元素为 { "key": "英文短名", "label": "中文名（单位）", "value": 数字 }；',
  '  chapter: 这道题对应的《通信原理》章节号（整数 1–13）；',
  '  confidence: 你对答案的置信度（0 到 1 的小数）；',
  '  caveat: 可选，口径说明或容易踩的坑（字符串，没有就省略）。',
  '数值必须自己算，写清代入过程；单位与量纲要保留在 label 里。',
].join('\n')

/** 把 Blob 读成 data URL，直接塞进 image_url。 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读图片失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 从模型回复里抠出 JSON：裸 JSON、```json 包裹、前后夹着客套话三种都要能取。
 * 抠不出来返回 null，调用方据此报错（绝不回退成演示答案）。
 */
export function extractJson(raw: string): unknown | null {
  const text = raw.trim()
  if (!text) return null
  const candidates: string[] = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 试下一种
    }
  }
  return null
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.eE+-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeParams(value: unknown): AnswerParam[] {
  if (!Array.isArray(value)) return []
  const out: AnswerParam[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const numeric = asNumber(row.value)
    if (numeric === undefined) continue
    out.push({
      key: asText(row.key) || `p${out.length + 1}`,
      label: asText(row.label) || asText(row.key) || '数值',
      value: numeric,
    })
  }
  return out
}

/** 把模型返回的 JSON 映射成界面要的形状；缺 headline 或 steps 就判失败。 */
export function parseModelAnswer(payload: unknown, meta: AnswerMeta = {}): AnswerReply {
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', message: '模型返回的不是 JSON 对象' }
  }
  const row = payload as Record<string, unknown>
  const headline = asText(row.headline) || asText(row.answer)
  const steps = Array.isArray(row.steps)
    ? row.steps.map(asText).filter((step) => step.length > 0)
    : []
  if (!headline || steps.length === 0) {
    return { status: 'error', message: '模型返回的 JSON 缺 headline 或 steps' }
  }
  const caveat = asText(row.caveat)
  return {
    status: 'ok',
    headline,
    steps,
    params: normalizeParams(row.params),
    ...(caveat ? { caveat } : {}),
    meta: {
      ...meta,
      confidence: asNumber(row.confidence),
      chapter: asNumber(row.chapter),
      transcript: asText(row.transcript) || undefined,
    },
  }
}

/** 内容块可能是字符串，也可能是 [{ type: 'text', text }] 形式，统一取文本。 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const row = part as Record<string, unknown>
          return asText(row.text)
        }
        return ''
      })
      .join('')
  }
  return ''
}

type ChatReply = {
  choices?: Array<{ message?: { content?: unknown } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  model?: string
}

/**
 * 真模型作答：图片直传，OpenAI 兼容的 chat/completions。
 * 任何一步失败都返回 `{ status: 'error' }`，绝不拿内置答案冒充模型作答。
 */
export const defaultProvider: AnswerProvider = async (request) => {
  const resolved = await resolveEndpoint()
  if (!resolved) return { status: 'offline' }

  const started = Date.now()
  try {
    const imageUrl = await blobToDataUrl(request.image)
    const instruction = [
      '请按系统提示要求的 JSON 字段作答，只输出 JSON。',
      request.text ? `本机 OCR 顺手识别到的题面（可能有错，以图为准）：\n${request.text}` : '',
      request.topicId > 0 ? `课程定位参考：第 ${request.topicId} 章。` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
    const response = await fetch(resolved.endpoint, {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: resolved.model ?? 'deepseek-flash',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    }).finally(() => clearTimeout(timer))

    if (!response.ok) {
      return { status: 'error', message: `模型端点返回 ${response.status}` }
    }

    const body = (await response.json()) as ChatReply
    const content = contentText(body.choices?.[0]?.message?.content)
    const payload = extractJson(content)
    if (!payload) {
      return { status: 'error', message: '模型回复里没有可解析的 JSON' }
    }
    return parseModelAnswer(payload, {
      model: body.model ?? resolved.model,
      ms: Date.now() - started,
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'error', message: `等了 ${MODEL_TIMEOUT_MS / 1000} s 还没有回复，这次没答上来` }
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '调用模型失败',
    }
  }
}