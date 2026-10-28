/**
 * 手写 hash 路由。
 *
 * 约定：
 * - 首页是 `#/`，QAM 页是 `#/qam`，卷积码页是 `#/conv`，OFDM 页是 `#/ofdm`，任务模式是 `#/mission`；
 * - 只靠 location.hash + hashchange 驱动，不引第三方路由库、不存额外状态，
 *   所以刷新、前进后退、地址栏手敲都走同一条路径；
 * - 空 hash 与未知路径一律回首页，避免手敲错地址出现空白页。
 */

export type Route = 'home' | 'qam' | 'conv' | 'ofdm' | 'mission'

/**
 * 把 location.hash 解析成路由名。纯函数，不碰 window，便于单测。
 *
 * 任务模式回填实验台时地址会带查询串（`#/qam?order=16&snr=12&bits=1000`），
 * 路由只认问号前面的路径，查询串交给页面自己读。
 */
export function parseHash(hash: string): Route {
  const at = hash.indexOf('?')
  const withoutQuery = at === -1 ? hash : hash.slice(0, at)
  const path = withoutQuery.replace(/^#/, '').replace(/\/+$/, '')
  if (path === '/qam') return 'qam'
  if (path === '/conv') return 'conv'
  if (path === '/ofdm') return 'ofdm'
  if (path === '/mission') return 'mission'
  return 'home'
}

/** 当前地址对应的路由。 */
export function currentRoute(): Route {
  return parseHash(window.location.hash)
}
