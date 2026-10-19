import './App.css'

const modules = [
  {
    id: 'qam',
    name: 'QAM 星座实验台',
    desc: '阶数切换、AWGN 噪声注入、EVM 与误符号率实时读数',
    status: '开发中',
  },
  {
    id: 'conv',
    name: '卷积码与 Viterbi',
    desc: '编码器配置、网格图、硬判决与软判决译码的误码对比',
    status: '待开始',
  },
  {
    id: 'ofdm',
    name: 'OFDM 时频链路',
    desc: '子载波映射、循环前缀、两径多径信道与均衡',
    status: '待开始',
  },
  {
    id: 'mission',
    name: '任务模式',
    desc: '给定信道条件，调参数把误码率压到阈值以下，系统自动判分',
    status: '待开始',
  },
]

export default function App() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">通信原理 · 交互实验室</p>
        <h1>把公式拖成能看见的波形</h1>
        <p className="lede">
          不用装 MATLAB，打开浏览器就能调 QAM 阶数、噪声强度和信道条件，
          实时看到星座图、译码结果和频谱怎么变。
        </p>
        <div className="cta">
          <span className="badge">v0.1 骨架 · 建设中</span>
          <a href="https://github.com/240000000/comm-lab" target="_blank" rel="noreferrer">
            源码仓库
          </a>
        </div>
      </header>

      <section className="grid" aria-label="实验模块">
        {modules.map((m) => (
          <article key={m.id} className="card">
            <div className="card-head">
              <h2>{m.name}</h2>
              <span className={m.status === '开发中' ? 'dot live' : 'dot'}>{m.status}</span>
            </div>
            <p>{m.desc}</p>
          </article>
        ))}
      </section>

      <footer className="foot">
        <p>纯前端实现 · 全部计算在浏览器内完成 · 不依赖后端服务</p>
      </footer>
    </main>
  )
}
