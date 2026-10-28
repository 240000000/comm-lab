/**
 * 原理短片地址的拼接。
 *
 * 视频放在 public/shorts/ 下，构建后落到 dist/shorts/；线上站点挂在 /comm-lab/，
 * 所以不能写死 /shorts/xxx.mp4。这里统一用 Vite 的 BASE_URL（开发是 /，构建是 /comm-lab/）
 * 拼出带前缀的地址，并保证 BASE_URL 自带或不带尾部斜杠时都不会出现双斜杠。
 */
export function shortFilmUrl(base: string, file: string): string {
  const dir = base.endsWith('/') ? base : `${base}/`
  const name = file.replace(/^\/+/, '')
  return `${dir}shorts/${name}`
}

/** 按钮文案按片长拼，页面只传秒数，不在组件里写死。 */
export function shortFilmLabel(seconds: number): string {
  return `先看 ${seconds} 秒原理短片`
}
