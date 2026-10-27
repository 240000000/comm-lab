import { useEffect, useState } from 'react'
import './App.css'
import { currentRoute, type Route } from './router'
import { QamPage } from './labs/QamPage'
import { ConvPage } from './labs/ConvPage'

const modules = [
  {
    id: 'qam',
    name: 'QAM 星座实验台',
    desc: '阶数切换、AWGN 噪声注入、EVM 与误符号率实时读数',
    status: '已接通',
    href: '#/qam',
  },
  {
    id: 'conv',
    name: '卷积码与 Viterbi',
    desc: '短序列四行对照、硬判决与软判决两套译码器、三条线的误码对比',
    status: '已接通',
    href: '#/conv',
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
  const [route, setRoute] = useState<Route>(currentRoute)

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (route === 'qam') {
    return <QamPage />
  }

  if (route === 'conv') {
    return <ConvPage />
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">通信原理 · 交互实验室</p>
        <h1>把公式拖成能看见的波形</h1>
        <p className="lede">
          不用装 MATLAB，打开浏览器就能调 QAM 阶数、噪声强度，也能把卷积码的编码和译码摊开看，
          实时看到星座图、比特流和误码率怎么变。
        </p>
        <div className="cta">
          <span className="badge">v0.5 · QAM 与卷积码</span>
          <a href="https://github.com/240000000/comm-lab" target="_blank" rel="noreferrer">
            源码仓库
          </a>
        </div>
      </header>

      <section className="grid" aria-label="实验模块">
        {modules.map((m) => {
          const head = (
            <div className="card-head">
              <h2>{m.name}</h2>
              <span className={m.status === '已接通' ? 'dot live' : 'dot'}>{m.status}</span>
            </div>
          )
          const body = <p>{m.desc}</p>

          return m.href ? (
            <a key={m.id} className="card" href={m.href}>
              {head}
              {body}
            </a>
          ) : (
            <article key={m.id} className="card">
              {head}
              {body}
            </article>
          )
        })}
      </section>

      <footer className="foot">
        <p>纯前端实现 · 全部计算在浏览器内完成 · 不依赖后端服务</p>
      </footer>
    </main>
  )
}
