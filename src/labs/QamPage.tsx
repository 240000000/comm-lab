/**
 * QAM 模块页。
 *
 * R3：接上星座映射（src/core/qam.ts），页面里放一张写死 16 阶的静态星座图。
 * 噪声、判决、误码率读数留给 R4，这里故意不做滑块。
 */
import ConstellationChart from './ConstellationChart'

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
          先把星座图摆出来：16 个点各自站在网格上，旁边那四位是它的格雷码标签。
          噪声一来，点就离开原位——加噪声、看误码率读数，下一轮接。
        </p>
      </header>

      <section className="chart-block" aria-label="星座图">
        <ConstellationChart order={16} />
      </section>

      <section className="next-up">
        <p>下一步：信噪比滑块、接收端点云、误码率读数。</p>
      </section>
    </main>
  )
}
