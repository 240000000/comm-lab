/**
 * R115：浏览器兼容层。
 *
 * pdf.js 6.5.438 内部大量使用 Map.prototype.getOrInsert / getOrInsertComputed
 * （build/pdf.mjs 22 处、legacy 27 处），这两条提案方法并非所有浏览器都有：
 * Chrome 141.0.7390.77 两个都是 undefined，Edge 157.0.4341.46 两个都是 function。
 * 缺了它们，每一页 render 都在内部抛 TypeError，整本 PDF 全白。
 *
 * 只补这两个方法：原生存在时一个字都不动；Promise.try / withResolvers 两版浏览器都有，不补。
 * 本文件必须早于 pdf.js 的动态 import 执行（见 src/main.tsx 第一行）。
 */

const proto = Map.prototype as unknown as Record<string, unknown>

/** 按提案描述符补一个方法：可写、可配置、不可枚举。 */
function defineMethod(name: string, value: (...args: never[]) => unknown): void {
  Object.defineProperty(Map.prototype, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

if (typeof proto.getOrInsert !== 'function') {
  defineMethod('getOrInsert', function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (this.has(key)) return this.get(key)
    this.set(key, value)
    return value
  })
}

if (typeof proto.getOrInsertComputed !== 'function') {
  defineMethod(
    'getOrInsertComputed',
    function (this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown) {
      if (this.has(key)) return this.get(key)
      const value = callback(key)
      this.set(key, value)
      return value
    },
  )
}
