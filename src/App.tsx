import { useEffect, useState } from 'react'
import './App.css'
import { currentRoute, type Route } from './router'
import { QamPage } from './labs/QamPage'
import { ConvPage } from './labs/ConvPage'
import { OfdmPage } from './labs/OfdmPage'
import { MissionPage } from './labs/MissionPage'
import { CoursePage } from './labs/CoursePage'
import { HomeBackdrop } from './labs/HomeBackdrop'
import { HomeParticles } from './labs/HomeParticles'

const modules = [
  {
    id: 'qam',
    index: '01',
    name: 'QAM 星座实验台',
    desc: '四档阶数（BPSK / QPSK / 16QAM / 64QAM）的星座与噪声云、EVM 与误符号率实时读数',
    href: '#/qam',
  },
  {
    id: 'conv',
    index: '02',
    name: '卷积码与 Viterbi',
    desc: '短序列四行对照、硬判决与软判决两套译码器、三条线的误码对比',
    href: '#/conv',
  },
  {
    id: 'ofdm',
    index: '03',
    name: 'OFDM 时频链路',
    desc: '两径信道、循环前缀长度可拖，看 CP 之外的延时怎么把子载波上的点推出方框',
    href: '#/ofdm',
  },
  {
    id: 'mission',
    index: '04',
    name: '任务模式',
    desc: '五道小题，答案都落在前三个实验台上：读一个数、看一个现象、数几位错、答概念、选方案',
    href: '#/mission',
  },
]

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute)
  // 首页两种模式：默认模式就是原来那四张卡，扩展模式放教材导入与课程视图入口。
  // 只活在组件里，不写 hash——冻结期不动路由，URL 记不住模式。
  const [homeMode, setHomeMode] = useState<'default' | 'extra'>('default')

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

  if (route === 'ofdm') {
    return <OfdmPage />
  }

  if (route === 'mission') {
    return <MissionPage />
  }

  if (route === 'course') {
    return <CoursePage />
  }

  return (
    <div className="home">
      <HomeBackdrop />
      <HomeParticles />
      <main className="shell">
        <header className="hero">
        <p className="eyebrow">通信原理 · 交互实验室</p>
        <h1>把公式拖成能看见的波形</h1>
        <p className="lede">
          不用装 MATLAB，打开浏览器就能在 BPSK、QPSK、16QAM、64QAM 四档之间换着看星座点怎么被噪声推离原位、
          误码率怎么抬起来；也能把卷积码从编码到译码摊开，一位一位看它纠回了什么、没纠回什么；
          还能拖循环前缀的长度，看多径的拖尾什么时候被关在 CP 里、什么时候压进数据段；
          最后用五道小题把这三页串起来，答案都要回实验台上自己读出来。
        </p>
        <div className="cta">
          <span className="badge">v0.11 · 三个实验台、任务模式与课程视图</span>
          <a href="https://github.com/240000000/comm-lab" target="_blank" rel="noreferrer">
            源码仓库
          </a>
        </div>
      </header>

      <div className="home-modes" role="group" aria-label="首页模式">
        <button
          type="button"
          className={homeMode === 'default' ? 'home-mode on' : 'home-mode'}
          aria-pressed={homeMode === 'default'}
          onClick={() => setHomeMode('default')}
        >
          默认模式
        </button>
        <button
          type="button"
          className={homeMode === 'extra' ? 'home-mode on' : 'home-mode'}
          aria-pressed={homeMode === 'extra'}
          onClick={() => setHomeMode('extra')}
        >
          扩展模式
        </button>
      </div>

      {homeMode === 'default' ? (
      <section className="grid" aria-label="实验模块">
        {modules.map((m) => {
          return (
            <a key={m.id} className="card" href={m.href}>
              <div className="card-head">
                <span className="card-index">{m.index}</span>
                <h2>{m.name}</h2>
              </div>
              <p className="card-desc">{m.desc}</p>
              <span className="card-enter">进入 →</span>
            </a>
          )
        })}
      </section>
      ) : (
        <section className="home-extra" aria-label="扩展模式面板">
          <section className="textbook-bar">
            <div className="textbook-head">
              <p className="textbook-current">
                当前教材：<strong>默认 13 章</strong>
              </p>
              <div className="textbook-actions">
                <a className="course-btn ghost" href="#/course">
                  导入 PDF 教材
                </a>
              </div>
            </div>
            <p className="textbook-note">
              选书、读书签、出账单都在课程视图里做；这一页只是入口，不读任何文件。
            </p>
          </section>

          <a className="course-entry" href="#/course">
            <div className="card-head">
              <span className="card-index">05</span>
              <h2>课程视图 · 13 章</h2>
            </div>
            <p className="card-desc">
              左树 13 章，每一章一屏：一句话问题、两三个滑块、一张图、三个读数、一句话结论。
            </p>
            <span className="card-enter">进入 →</span>
          </a>

          <p className="home-extra-note">只读你的目录，不读正文；PDF 不上传、不落盘。</p>
        </section>
      )}

        <footer className="foot">
          <p>纯前端实现 · 全部计算在浏览器内完成 · 不依赖后端服务</p>
        </footer>
      </main>
    </div>
  )
}
