/**
 * 手写 hash 路由。
 *
 * 约定：
 * - 首页是 `#/`，QAM 页是 `#/qam`；
 * - 只靠 location.hash + hashchange 驱动，不引第三方路由库、不存额外状态，
 *   所以刷新、前进后退、地址栏手敲都走同一条路径；
 * - 空 hash 与未知路径一律回首页，避免手敲错地址出现空白页。
 */

export type Route = 'home' | 'qam' | 'conv'

/** 把 location.hash 解析成路由名。纯函数，不碰 window，便于单测。 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '')
  if (path === '/qam') return 'qam'
  if (path === '/conv') return 'conv'
  return 'home'
}

/** 当前地址对应的路由。 */
export function currentRoute(): Route {
  return parseHash(window.location.hash)
}
