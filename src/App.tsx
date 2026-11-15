import { useEffect, useState } from 'react'
import './App.css'
import { currentRoute, type Route } from './router'
import { QamPage } from './labs/QamPage'
import { ConvPage } from './labs/ConvPage'
import { OfdmPage } from './labs/OfdmPage'
import { MissionPage } from './labs/MissionPage'
import { CoursePage } from './labs/CoursePage'
import SolvePage from './labs/SolvePage'
import { HomeBackdrop } from './labs/HomeBackdrop'
import { HomeParticles } from './labs/HomeParticles'
import { bookById, nextBookId } from './course/shelf'
import {
  clearPdf,
  getShelf,
  hydrate,
  importBook,
  markPdfSaved,
  noteStorage,
  removeBookById,
  setActive,
  setKeepPdf,
  useShelf,
} from './course/shelfStore'
import { readBookFile, type BookImportState } from './labs/bookImport'
import { saveOriginalPdf } from './labs/bookStorage'
import { ShelfPanel } from './labs/ShelfPanel'
import { ModulePanel } from './labs/ModulePanel'

type StepArtKind = 'book' | 'camera' | 'slider'

// 三分钟路径的小图：纯内联 SVG，跟着页面走，不额外请求资源。
function StepArt({ kind }: { kind: StepArtKind }) {
  const common = { width: 56, height: 44, viewBox: '0 0 56 44', 'aria-hidden': true as const }
  if (kind === 'book') {
    return (
      <svg {...common} className="path-art">
        <rect x="8" y="6" width="34" height="32" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M25 6v32" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
        <path d="M13 14h8M13 20h8M30 14h8M30 20h8" stroke="currentColor" strokeWidth="1.2" opacity="0.75" />
        <path d="M42 30l7 5-7 5z" fill="currentColor" opacity="0.8" />
      </svg>
    )
  }
  if (kind === 'camera') {
    return (
      <svg {...common} className="path-art">
        <rect x="7" y="12" width="34" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M17 12l3-4h8l3 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M44 20v10" stroke="currentColor" strokeWidth="1.4" opacity="0.7" />
      </svg>
    )
  }
  return (
    <svg {...common} className="path-art">
      <path d="M6 26c6-14 12 14 18 0s12 10 18-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 34h44" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <circle cx="36" cy="22" r="3.2" fill="currentColor" />
      <path d="M36 8v9" stroke="currentColor" strokeWidth="1.4" opacity="0.7" />
    </svg>
  )
}

const modules = [
  {
    id: 'course',
    index: '05',
    name: '课程视图（13 章）',
    desc: '13 章逐章可交互，每章两个命名档位共 26 个入口；导入课本后左右同屏看书，目录与正文都对得回原页',
    href: '#/course',
  },
  {
    id: 'solve',
    index: '06',
    name: '答题模式',
    desc: '上传题目截图，接了模型就把原图交给模型作答，没接模型时本机识别、内置题库演示',
    href: '#/solve',
  },
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
  // 首页两种模式：默认模式就是原来那四张卡，扩展模式放教材导入与功能模块表。
  // 进课程视图的唯一入口是书架上的某本书：点它就把那本设为当前书并跳过去。
  // 只活在组件里，不写 hash——冻结期不动路由，URL 记不住模式。
  const [homeMode, setHomeMode] = useState<'default' | 'extra'>('default')
  // 书架是模块级状态（shelfStore）：这一页与课程视图读同一份，落盘在 IndexedDB。
  const shelf = useShelf()
  const activeBook = bookById(shelf.books, shelf.activeId)
  const [importState, setImportState] = useState<BookImportState>({ status: 'idle' })
  // 正在往本机存原文件的文件名；存的过程可能几秒，面板要显示出来。
  const [savingName, setSavingName] = useState<string | null>(null)

  // 挂载时读一次本机书架。读完之前面板说「正在读取」，课程视图照旧用默认那本渲染。
  useEffect(() => {
    void hydrate()
  }, [])

  // 点书架上的书：先把它设为当前书，再跳课程视图。
  // 路由是手写 hash，改 location.hash 会触发 hashchange，上面的监听会重渲染。
  const enterCourse = (id: string) => {
    setActive(id)
    window.location.hash = '#/course'
  }

  // 选完文件就地变成一本书：解析成功才进书架并切过去，失败只说人话，书架不动。
  // 目录先落盘，原文件按开关与空间另存——存不下不影响这一轮用这本书。
  const importFile = async (file: File) => {
    setImportState({ status: 'parsing', fileName: file.name })
    const result = await readBookFile(file, nextBookId(getShelf().books))
    if (!result.ok) {
      setImportState({ status: 'failed', fileName: file.name, message: result.message })
      return
    }
    importBook(result.book)
    setActive(result.book.id)
    setImportState({ status: 'idle' })
    noteStorage(null)
    if (!shelf.keepPdf) {
      noteStorage('这次只存了目录（「导入时同时保存原文件」关着）')
      return
    }
    setSavingName(file.name)
    const saved = await saveOriginalPdf(file, result.book.id)
    setSavingName(null)
    if (saved.status === 'saved') markPdfSaved(result.book.id, saved.bytes)
    else noteStorage(saved.message)
  }

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

  if (route === 'solve') {
    return <SolvePage />
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
          <span className="badge">v0.11 · 13 章课程视图 · 26 个入口 · 教材导入 · 答题模式</span>
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

      <section className="path-band" aria-label="三分钟路径">
        <p className="path-head">
          三分钟路径
          <span>按顺序点三下，就知道这个页面能干什么</span>
        </p>
        <ol className="path-steps">
          <li>
            <button type="button" className="path-step" onClick={() => setHomeMode('extra')}>
              <StepArt kind="book" />
              <span className="path-body">
                <span className="path-no">①</span>
                <span className="path-title">把课本拖进来</span>
                <span className="path-line">打开扩展模式的书架面板，拖一份 PDF 进去，13 章自动对上目录。</span>
              </span>
            </button>
          </li>
          <li>
            <a className="path-step" href="#/solve">
              <StepArt kind="camera" />
              <span className="path-body">
                <span className="path-no">②</span>
                <span className="path-title">拍一道题</span>
                <span className="path-line">上传题目截图，看它落到第几章、要不要跳回实验台读一个数。</span>
              </span>
            </a>
          </li>
          <li>
            <a className="path-step" href="#/course?no=6">
              <StepArt kind="slider" />
              <span className="path-body">
                <span className="path-no">③</span>
                <span className="path-title">拖滑块看它失效</span>
                <span className="path-line">第 6 章把滚降系数拉大、采样点拖偏，黄色警示会告诉你眼图闭了。</span>
              </span>
            </a>
          </li>
        </ol>
      </section>

      {homeMode === 'default' ? (
      <section className="grid home-grid" aria-label="实验模块">
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
          <ShelfPanel
            books={shelf.books}
            activeId={shelf.activeId}
            importState={importState}
            ready={shelf.ready}
            storedIds={shelf.storedIds}
            pdfBytes={shelf.pdfBytes}
            keepPdf={shelf.keepPdf}
            savingName={savingName}
            persistNote={shelf.persistNote}
            onPick={enterCourse}
            onRemove={removeBookById}
            onClearPdf={clearPdf}
            onImport={importFile}
            onToggleKeepPdf={setKeepPdf}
          />

          <ModulePanel book={activeBook} />

          <section className="home-extra-block" aria-label="答题模式入口">
            <h2 className="home-extra-title">答题模式</h2>
            <a className="solve-entry" href="#/solve">
              <span className="solve-entry-main">答题模式 · 上传题目截图</span>
              <span className="solve-entry-desc">
                上传一张题目截图，本机识别题面、定位到对应章节，并在右侧直接打开实验台。
              </span>
              <span className="card-enter">进入 →</span>
            </a>
          </section>
        </section>
      )}

        <footer className="foot">
          <p>纯前端实现 · 全部计算在浏览器内完成 · 不依赖后端服务</p>
        </footer>
      </main>
    </div>
  )
}
