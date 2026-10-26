/**
 * QAM 模块页。
 *
 * 本轮只搭骨架：标题、一句说明、返回入口、一块占位。
 * 星座图、噪声链路、误码率读数从下一轮开始接，这里故意不写任何算法。
 */
export default function QamPage() {
  return (
    <main className="shell">
      <a className="back" href="#/">
        ← 返回首页
      </a>

      <header className="hero">
        <p className="eyebrow">QAM 星座实验台</p>
        <h1>星座点为什么会被噪声推离原位</h1>
        <p className="lede">
          这里将放星座图、信噪比滑块和误码率读数。当前页面只接通了路由，图和算法还没接。
        </p>
      </header>

      <section className="placeholder" aria-label="内容占位">
        <p>内容待接入</p>
        <p className="placeholder-hint">下一轮：QAM 星座映射与静态星座图</p>
      </section>
    </main>
  )
}
