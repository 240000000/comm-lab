/**
 * R115 / R132：浏览器兼容层。
 *
 * pdf.js 6.5.438 内部大量使用 Map / WeakMap 的 getOrInsert 与 getOrInsertComputed
 * （build/pdf.mjs 22 处、legacy 27 处），这两条提案方法并非所有浏览器都有：
 * Chrome 141.0.7390.77 两个都是 undefined，Edge 157.0.4341.46 两个都是 function。
 * 缺了它们，每一页 render 都在内部抛 TypeError，整本 PDF 全白。
 *
 * R115 只补了 Map.prototype，是漏：那 22 处里至少 3 处挂在 WeakMap 上——
 * `#operatorLists`（pdf.mjs:15498）、`#pathCaches`（pdf.mjs:9886）、
 * `#canvasCtxFonts`（pdf.mjs:15841），它们分别是 OperatorList、路径缓存与字体缓存的键集。
 * 只补 Map 时，扫描版教材一翻页就在 WeakMap 那几行炸掉，症状同样是整页白。
 * 所以这里对 Map.prototype 与 WeakMap.prototype 同时补，两边行为一致。
 *
 * 只补这两个方法：原生存在时一个字都不动；Promise.try / withResolvers 两版浏览器都有，不补。
 * 本文件必须早于 pdf.js 的动态 import 执行（见 src/main.tsx 第一行）。
 */

type MethodHost = Record<string, unknown>

/** 按提案描述符补一个方法：可写、可配置、不可枚举。 */
function defineMethod(
  proto: MethodHost,
  name: string,
  value: (...args: never[]) => unknown,
): void {
  Object.defineProperty(proto, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

const getOrInsert = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
  if (this.has(key)) return this.get(key)
  this.set(key, value)
  return value
}

const getOrInsertComputed = function (
  this: Map<unknown, unknown>,
  key: unknown,
  callback: (key: unknown) => unknown,
) {
  if (this.has(key)) return this.get(key)
  const value = callback(key)
  this.set(key, value)
  return value
}

/** 两个宿主一起补；原生已有的一方不动。 */
function patch(host: MethodHost): void {
  if (typeof host.getOrInsert !== 'function') defineMethod(host, 'getOrInsert', getOrInsert)
  if (typeof host.getOrInsertComputed !== 'function') {
    defineMethod(host, 'getOrInsertComputed', getOrInsertComputed)
  }
}

patch(Map.prototype as unknown as MethodHost)
patch(WeakMap.prototype as unknown as MethodHost)