/**
 * 答题模式的中转 Worker。
 *
 * 为什么需要它：本站是纯静态托管，前端拿到的任何 key 都能被直接读走，
 * 仓库又是公开的，写进代码就永久留在 git 历史里。所以 key 只放这里，
 * 由 Cloudflare 在服务端注入环境变量 DEEPSEEK_API_KEY。
 *
 * 部署：npx wrangler deploy（在本目录下），详见 README.md。
 */

const UPSTREAM = 'https://api.deepseek.com/v1/chat/completions'

/** 只接受自家页面，别人把端点抄走也用不了。 */
const ALLOWED_ORIGINS = [
  'https://240000000.github.io',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]

/** 只允许这一个模型，防止有人换成贵的。 */
const ALLOWED_MODEL = 'deepseek-flash'

/** 每 IP 每分钟最多这么多次；演示够用，被白嫖也烧不快。 */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

/** 单次请求体上限：题目截图 base64 再大也到不了 8 MB。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const hits = new Map()

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'origin'
  }
}

function rateLimited(ip) {
  const now = Date.now()
  const bucket = hits.get(ip)
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 })
    return false
  }
  bucket.count += 1
  if (hits.size > 2000) hits.clear()
  return bucket.count > RATE_LIMIT
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' }
  })
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? ''
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json(403, { error: { message: '不允许的来源' } }, origin)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }
    if (request.method !== 'POST') {
      return json(405, { error: { message: '只接受 POST' } }, origin)
    }
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (rateLimited(ip)) {
      return json(429, { error: { message: '请求太频繁，歇一分钟再来' } }, origin)
    }

    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return json(413, { error: { message: '请求体太大' } }, origin)
    }

    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return json(400, { error: { message: '请求体不是 JSON' } }, origin)
    }
    if (payload?.model !== ALLOWED_MODEL) {
      return json(400, { error: { message: `只支持 ${ALLOWED_MODEL}` } }, origin)
    }

    const key = env.DEEPSEEK_API_KEY
    if (!key) {
      return json(500, { error: { message: '服务端没配 key' } }, origin)
    }

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: raw
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' }
    })
  }
}
