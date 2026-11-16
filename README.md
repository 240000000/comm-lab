# 通信原理交互实验室

13 章通信原理，每章两个档位共 26 个入口，每个公式都能拖，拖坏了它会告诉你为什么。

不需要 MATLAB，不需要装环境，打开浏览器就行。在线地址：https://240000000.github.io/comm-lab/

**作品介绍：** [docs/preview.md](docs/preview.md)　**演示视频脚本：** [docs/video-script.md](docs/video-script.md)

---

## 一、打开就能做的四件事

1. **进课程视图**（`#/course`）。左边 13 章目录，右边一屏五段：原理一句、公式一个、滑块让你自己拖、读数三个、再给一句「拖坏了会怎样」。每章下面挂两个档位：默认档是这一章的正常参数，对照档故意把让它成立的那条前提拆掉——第 6 章把 CP 压到 0，多径拖尾直接压进数据段；第 7 章把时间窗收窄到 0.2，眼图当场闭上。
2. **导入自己的教材**。选一个 PDF，它只读目录书签和正文取样，文件不出本机。13 章能对上就给覆盖面板，对不上就说「仅按标题」，不装作读懂了。
3. **拍一道题**（`#/solve`）。截图上传，接了模型就把原图直接交给模型；没接模型就在本机做 OCR、从内置三题里找。答案里的波形规格由模型给，波形由前端按规格现算，所以相位不会画反。
4. **拖滑块看反例**。四个实验台（`#/qam`、`#/conv`、`#/ofdm`、`#/mission`）各自能拖，任务模式五道题的答案都要回实验台上亲手读出来。

## 二、四个入口的路由表

| 地址 | 是什么 | 第一次进来先看什么 |
| --- | --- | --- |
| `#/` | 首页 | 四张卡与「三分钟路径」，右侧一栏写清边界 |
| `#/course` | 课程视图，13 章 × 2 档 = 26 个入口 | 第 1 章先拖一遍滑块，再看第 6 章的对照档 |
| `#/solve` | 答题模式 | 内置一道示例题，看卡 2 的题面与卡 3 的答案 |
| `#/limits` | 限制页 | 「现在能做到」与「故意不做」两栏 |

四个实验台：`#/qam`（星座与误码率，四档可切）、`#/conv`（卷积码编码到译码，含 Viterbi）、`#/ofdm`（64 个子载波，CP 与多径）、`#/mission`（五道题 + 自己出题）。

实验台与课程视图共用一个入口组件，地址里带的参数会原样回填到滑块上；页面右上角给一个「还原默认」。

## 三、教材是怎么读的

四关，一关不过就往后退一档，退到哪一档都会写在面板上：

1. **书签优先**。`getOutline()` 拿目录树，章节标题按「第 N 章」切；书签全丢的扫描件走第二关。
2. **本地 OCR**。没文字层的页用本机 tesseract 识别（资源在 `public/`，运行时不上传、不联网），识别结果按 `bookId` 缓存，下次开书不再重跑。
3. **正文取样打分**。每章取首页与中段两页，干净页至少命中 10 个词（`MIN_BODY_HITS = 10`）；章节归属先看正文分数（Top1 ≥ 3 且领先第二名 ≥ 2），分数不够才退回标题匹配。
4. **覆盖面板三色**。绿=正文与题目都对上、黄=只对上标题、灰=没读出来。读不到就明确写「仅按标题」，不编内容。

导进来的原件与课程视图同屏：左边书、右边一屏五段，可以拖动分栏。换了教材能识别目录与覆盖，但交互内容目前只做了通信原理这一本。

## 四、四条命令

| 命令 | 一句话 |
| --- | --- |
| `npm ci` | 按 `package-lock.json` 装 28 个包，2.6 秒；只需要 Node ≥ 24，没有别的依赖 |
| `npm test`（453 条） | 用 Node 自带的 test runner 跑 `tests/*.test.ts`，2.5 秒；算法对不对靠它说话 |
| `npm run check:docs` | 用 `src/core` 现算一遍，把文档里的数字、tag 名、表格与截图逐个对一遍，不一致就打印行号并退出 1 |
| `npm run build` | 产出 `dist/`，构建时 `base` 自动切成 `/comm-lab/`；先跑 `tsc` 再打包，两套检查都要过 |

四个实验台与课程视图的算法都在 `src/core` 与 `src/course` 里，453 条单测覆盖的就是这些纯函数——页面只是把它们的输出画出来。因此改算法先看测试，改样式不必跑全量。

本地看页面：`npm run dev` 起 Vite（200 ms 内 ready），打开终端里那行地址。预览构建产物用 `npm run preview`。

从空目录到第一张图（Windows、Node v24.18.0，2026-10-27 实测）：`git clone --depth 1` 4.8 s → `npm ci` 2.6 s → `npm run dev` 0.2 s，合计不到八秒；`npm run build` 0.8 s。

## 五、目录结构

```
comm-lab/
├── src/
│   ├── core/            纯计算：qam rng channel metrics ber curve conv convCurve dft ofdm missions customQuestion labQuestions commands
│   ├── course/          教材与课程视图（18 个文件）
│   │                    syllabus 章节表 · match 章节匹配 · sections 正文取样与覆盖
│   │                    chapterBody 正文抽取 · pdfText 文字层 · pdfOutline 书签
│   │                    ocr / outlineOcr / chapterOcr 本地识别 · concepts 概念锚点
│   │                    shelf / shelfDb / shelfStore 书架与 IndexedDB · presets 26 档参数
│   ├── answer/          答题模式（5 个文件）：provider 模型请求 · bank 内置题 · locate 题面定位
│   │                    presets 右栏跳转 · diagram 波形规格渲染
│   ├── ui/              动效（2 个文件）：motion.ts 时长常量 · motion.css 过渡与焦点环
│   ├── labs/            页面与图表组件（课程视图、答题模式、四个实验台、各 Canvas 图）
│   └── App.tsx App.css index.css main.tsx compat.ts
├── tests/               Node test runner，当前 453 条用例
├── docs/                技术报告、作品介绍、preview、视频脚本、图解、存档与对话索引
├── public/              示例教材、OCR 资源、录音与短片
└── scripts/             check-docs.mjs · pack.mjs · 其他一次性脚本
```

## 六、开发与提交约定

- 一个轮次一个 commit，说明写 `type(scope): 说明 [R轮次]`；纯文字校订单独提交，不带前缀。
- 先写判据再写实现；判据被实测推翻就改判据并留下记录，不改数字迎合结论。
- 核心算法自写（QAM、信道、BER 统计、卷积码、Viterbi、64 点 DFT），不引通信库；界面与注释用中文。
- 测试只用 Node 内置的 `node --test` 与 `assert`，不引测试框架。

发布顺序固定：commit → `git tag -a R轮次` → `npm run check:docs` → 先推 tag 再推 main。`check:docs` 里有「轮次表行数 = `git tag -l` 行数」的断言，所以顺序反过来会假绿——R29 就因为先校验后打 tag 绿过一回，后来 amend 强推才纠正。

## 七、已知限制

- 纯扫描件没有书签也没有文字层时导不进来；有文字层的扫描件会走本地 OCR，慢一些但能用。
- 超过 250 MB 的 PDF 直接拒绝；加密或损坏的文件只提示，不会静默失败。
- 目前只落地通信原理这一本教材，其他教材能识别目录与覆盖，交互内容在逐章补充。

完整清单在 `#/limits`：分「现在能做到」与「故意不做」两栏，每条都写明判据。

## 八、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面一片空白 | 多半是浏览器太旧（少了 `Map.prototype.getOrInsert` 这类新方法，`src/compat.ts` 已补丁）；仍有问题就开控制台看 `[pdf-pane]` 前缀的报错 |
| 线上直接打开 404 | 地址漏了 `/comm-lab/` 这一层；本地开发则是根路径，两者不一样 |
| `npm ci` 失败 | Node 低于 24 会装不上；`nvm use 24` 再试 |

---

当前 453 条用例，`npm run check:docs` 182 条断言 0 不符。许可与引用见仓库根目录 `LICENSE`。