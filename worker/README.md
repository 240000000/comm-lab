# 答题模式中转 Worker

站点是纯静态托管（GitHub Pages），前端拿到的任何 key 都能被读走，仓库又是公开的。
所以模型 key 只放在这里，由 Cloudflare 在服务端注入。

## 部署（一次，约 5 分钟）

```bash
cd worker
npx wrangler login                        # 浏览器里点一下授权，不需要给密码
npx wrangler secret put DEEPSEEK_API_KEY  # 粘贴你的 key，只进 Cloudflare，不进仓库
npx wrangler deploy
```

部署完会打印一个地址，形如：

```
https://comm-lab-answer.<你的子域>.workers.dev
```

## 接上前端

把上面那个地址加 `/v1/chat/completions` 填进 `public/answer-config.json`：

```json
{
  "endpoint": "https://comm-lab-answer.<你的子域>.workers.dev/v1/chat/completions",
  "model": "deepseek-flash",
  "note": "端点公开、key 在服务端；留空则走离线三题。"
}
```

提交后线上就是「任意题截图 → 模型作答」。端点留空时前端自动退回内置三题，并标「演示模式」。

## 已经做过的限制

- 只放行 `240000000.github.io` 与本地 `5173`/`4173` 两个端口，别人抄走端点也用不了；
- 只接受 `deepseek-flash` 一个模型，防止被换成贵的；
- 每 IP 每分钟 20 次，被白嫖也烧不快；
- 请求体上限 8 MB，单张题目截图足够；
- 服务端没配 key 时返回 500 并说明，不会静默失败。

## 本地自测（不部署也能验逻辑）

```bash
node --input-type=module -e "
import w from './answer-proxy.js'
const r = await w.fetch(new Request('https://x/v1/chat/completions', {
  method: 'POST',
  headers: { origin: 'https://240000000.github.io', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-flash', messages: [] })
}), { DEEPSEEK_API_KEY: 'dummy' })
console.log(r.status)
"
```

正常应当先看到上游返回 401（假 key），说明转发链路通了。
