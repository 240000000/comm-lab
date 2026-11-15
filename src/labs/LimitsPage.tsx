/**
 * 已知限制页（R136）。
 *
 * 写这一页的规矩：只写「现在能做什么 / 还在完善」，不写死的否定句。
 * 每一句都对着仓库里真有的东西说——484 页的原书、296 条书签、扫描件 13 章 OCR、
 * 26 个章档入口——写不出来的就不写，不拿「即将支持」凑数。
 */
import { useEffect } from 'react'

type LimitSection = {
  id: string
  title: string
  now: string[]
  next: string[]
}

const SECTIONS: LimitSection[] = [
  {
    id: 'import',
    title: '教材导入',
    now: [
      'PDF 拖进扩展模式的书架就能认：先读书签树，没有书签就读前 40 页文字层找目录页，两种都认出来就按章进入课程视图。',
      '扫码版（整页是图、没有文字层）走本地 tesseract：封面与目录页 OCR 出章名，逐章首页再 OCR 一次，13 章能对上 13 章。',
      '导入后立刻给一份覆盖报告：26 个章档入口里，几个有正文依据（绿）、几个只按章名对上（黄）、几个这本教材没涉及（灰）。',
      '书架里「载入示例教材」随时可试，它是自写的 15 页《通信原理示例教材》，13 章正文都能对上，26 项全绿。',
    ],
    next: [
      '目前只把通信原理这一本教材的 13 章做成了可交互内容；换一本书能看到目录、覆盖报告与同屏看书，交互内容正在逐章补充。',
      '章名与课程表对不上的教材，现在按标题重名兜底；语义近似的章名匹配已排进下一步。',
      '扫描件的正文只 OCR 每章首页，正文取样偏薄时界面会如实标「正文取样不足」，整章 OCR 已排进下一步。',
    ],
  },
  {
    id: 'solve',
    title: '答题模式',
    now: [
      '上传题目截图后，接了模型端点（public/answer-config.json 里配转发地址）就把原图直接交给模型看图作答，不再等本机 OCR。',
      '没接端点时走本机识别 + 内置题库：三章样题（第 7 章、第 8 章、第 11 章）认得出来，答案与右栏参数一起给。',
      '模型只看图不答题时界面会明说「这次模型没有给出答案」，不会悄悄换成离线答案糊过去。',
      '端点超时按「握手 / 首字 / 整段」三类分开报，600 ms 内可以点重试。',
    ],
    next: [
      '模型看图与右栏联动目前只覆盖通信原理的 13 章；题面跨章的综合题正在补。',
      '手写公式与手绘波形图的识别率还在提高，下一步补针对手写体的预处理。',
      '端点由使用者自己部署（仓库只放空模板），团队不代管 key，也不中转上传的图片。',
    ],
  },
  {
    id: 'course',
    title: '课程视图',
    now: [
      '13 章逐章可交互，每章两个命名档位（默认档 / 对照档），一共 26 个入口，地址可以直接写 #/course?no=8&preset=b 进到某一档。',
      '每章右栏有读数与波形，参数条拖一下就地重算；切章自动回到该章默认档。',
      '导入教材后左右同屏：左边原文页、右边实验台，目录点哪一章就翻到那一章的原页。',
      '导入的原件与解析结果存在浏览器本地，换浏览器要重新导入。',
    ],
    next: [
      '26 个档位里目前有 13 个是默认档、13 个是对照档；更细的实验参数组合正在逐章补。',
      '第 12 章 m 序列的抽头表只给了四档短周期，长周期抽头正在补。',
      '原件整页渲染依赖 pdf.js，超大页面在低配机器上会先出骨架条再出图，正在优化首屏。',
    ],
  },
  {
    id: 'labs',
    title: '深度实验台',
    now: [
      'QAM 星座与误码率、卷积码与 Viterbi、OFDM 与循环前缀、任务模式四张台子都能拖参数看波形，读数是现算的。',
      '任务模式把四个实验串成一条链：按题目要求改参数，右栏实时告诉你做对没有。',
      '所有计算都在浏览器里跑，断网也能用；不引通信库，核心算法是手写的。',
    ],
    next: [
      '星座图与眼图的自动绘制目前覆盖 PSK、FSK 与基带眼图，更多调制样式的图正在补。',
      '卷积码现在支持 (2,1,3) 与 (2,1,7) 两档记忆深度，更长约束长度的译码正在加。',
      '一次实验的结果目前只看当页，导出成图片或表格已排进下一步。',
    ],
  },
  {
    id: 'privacy',
    title: '数据与隐私',
    now: [
      '导入的 PDF、解析出的目录与正文、答题截图都只存在这台机器的浏览器里（IndexedDB），刷新或关页面不会上传。',
      '只有答题模式在配了端点、并且你点了上传之后，那一张截图才会发到你配的地址；地址写在 public/answer-config.json，仓库里只有空模板。',
      '页面本身是纯静态站，没有后端、没有账号、不埋第三方统计脚本。',
      '书架里可以随时「清除原件」，原件与派生的正文取样一起删掉。',
    ],
    next: [
      '导出与清理目前按书一本一本做，批量管理与容量提示正在补。',
      '端点侧的日志由部署方自己决定，本作品不代管也不转发。',
    ],
  },
]

export function LimitsPage() {
  // 从课程视图/答题模式/书架点过来时会带 ?part=xxx，滚到对应那一节再高亮一下。
  useEffect(() => {
    const query = window.location.hash.split('?')[1] ?? ''
    const part = new URLSearchParams(query).get('part')
    if (!part) return
    const target = document.getElementById(`limits-${part}`)
    if (!target) return
    target.scrollIntoView({ block: 'start' })
    target.classList.add('is-focus')
  }, [])

  return (
    <main className="lab limits">
      <header className="limits-head">
        <div>
          <h1>已知限制</h1>
          <p className="limits-lede">本作品目前只做了通信原理这一本书的交互内容，换教材能识别但不保证能玩。</p>
        </div>
        <a className="limits-back" href="#/">
          返回首页
        </a>
      </header>

      <ol className="limits-list">
        {SECTIONS.map((section) => (
          <li className="limits-item" id={`limits-${section.id}`} key={section.id}>
            <h2 className="limits-title">{section.title}</h2>
            <div className="limits-cols">
              <section className="limits-col">
                <h3>现在能做什么</h3>
                <ul>
                  {section.now.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
              <section className="limits-col limits-col-next">
                <h3>还在完善</h3>
                <ul>
                  {section.next.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            </div>
          </li>
        ))}
      </ol>

      <p className="limits-foot">
        这一页按「现在能做什么 / 还在完善」写，每一条都对着仓库里已有的实现。
        <a href="#/course">去课程视图</a>
        <a href="#/solve">去答题模式</a>
      </p>
    </main>
  )
}
