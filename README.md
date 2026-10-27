# 通信原理交互实验室

> 拖一下滑块，就能看见 QAM 星座被噪声推散；翻开一条短序列，看得见卷积码把打翻的比特纠回来。不需要 MATLAB，不需要装环境，打开浏览器就行。
>
> 现在到哪一步了：QAM 页能拖信噪比滑块（阶数暂时写死 16QAM），看 16QAM 点云怎么糊开，底下给出误码率、误符号率、EVM 三个读数，再往下是 0–20 dB 的误码率曲线和理论对照；卷积码页也接通了，一条 12 比特短序列把「原始 → 编码 → 加噪 → 译码」四行摊开，可以关噪声、手动翻位，下面同样是误码率对照曲线；OFDM 页能拖 CP 长度和延时，看两径的拖尾什么时候被关在循环前缀里、什么时候压进数据段，下面并排给出有 CP / 无 CP 两组误符号率和 64 个子载波上的接收点。任务模式还没开始。

**作品介绍：** [docs/preview.md](docs/preview.md)　**演示视频脚本：** [docs/video-script.md](docs/video-script.md)

**在线 Demo：** https://240000000.github.io/comm-lab/

> 当前版本 `v0.6`：三个实验台都能玩，82 条单测。状态见下面「打开之后点什么」。

## 这个项目是什么

通信原理课上的 QAM 星座、误码率、卷积码、OFDM 与循环前缀，平时都是一页公式，换个信噪比就得重新算。这个项目做了其中三件：QAM 的加噪与误码率、卷积码的编译码、OFDM 的循环前缀与两径信道。拖一个滑块，星座点立刻散开；翻开一条短序列，能看见哪几位被噪声打翻、译码器把它们纠回了几位。

全部计算在浏览器里用 TypeScript 手写完成，不连后端、不调任何模型接口、不依赖通信仿真库。

## 十分钟跑起来

前置条件：Node.js ≥ 24（本项目在 v24.18.0 上验证；`npm test` 直接跑 `.ts` 测试文件，靠的是 Node 内置的类型擦除）、npm ≥ 10。不需要后端、数据库、账号，也不需要配置任何密钥。

### 1. 装依赖

```bash
git clone https://github.com/240000000/comm-lab.git
cd comm-lab
npm ci
```

`npm ci` 严格按 `package-lock.json` 安装。没有 lockfile、或报 lockfile 不一致时，删掉 `node_modules` 后改用 `npm install`。

### 2. 起服务

```bash
npm run dev
```

终端会打印本地地址，默认 `http://localhost:5173/`。端口被占用时 Vite 会自动换一个号，**以终端实际打印的地址为准**。

### 走一遍要多久（实测）

下面这组数是 2026-10-27 在一台 Windows 机器上、把仓库重新克隆到空目录后按上面三步跑出来的（Node v24.18.0，npm 11.x，网络为家宽直连 GitHub）：

| 步骤 | 命令 | 实测耗时 |
| --- | --- | --- |
| 克隆 | `git clone --depth 1 …` | 4.8 s |
| 装依赖 | `npm ci`（28 个包） | 2.6 s |
| 起服务 | `npm run dev`，等终端打印地址 | 0.2 s（Vite 报 `ready in 200 ms`） |
| 构建 | `npm run build` | 0.8 s |
| 跑测试 | `npm test`（82 条） | 0.6 s |

从克隆到终端打印出地址，这台机器上不到八秒；网络慢的时候主要慢在克隆和装依赖这两步。机器快慢和网络都会影响这组数。

### 3. 打开之后点什么

打开终端给出的那个地址，首页是四张卡，现在前三张能点进去，最后一张标着「待开始」：

| 卡片 | 现在能做什么 |
| --- | --- |
| QAM 星座实验台 | 拖信噪比滑块（0–20 dB）看点云散开，读误码率/误符号率/EVM（都带分母），下方是 0–20 dB 误码率曲线与理论对照 |
| 卷积码与 Viterbi | 12 比特短序列四行对照（原始/编码/加噪/译码），可关噪声、手动翻 1/2/4 位看纠得回还是纠不回；下方是 0–10 dB 三条线：不编码、硬判决、软判决 |
| OFDM 时频链路 | 拖 CP 长度与延时：CP 之内两条误符号率一个有错、一个为零，CP 之外两边都开始错；下方是 64 个子载波的接收点，有 CP / 无 CP 并排 |
| 任务模式 | 待开始 |

模块逐个接入，接通一个就改这张表里的一行。QAM 页的地址是 `#/qam`，卷积码页是 `#/conv`，OFDM 页是 `#/ofdm`，首页是 `#/`，直接敲进地址栏或刷新都停在同一页。

## 环境变量

本项目不需要任何密钥或环境变量，不配置也能完整运行。仓库里的 [`.env.example`](.env.example) 只是模板说明：写清了这个项目为什么不读密钥，以及将来若真要加配置，Vite 的 `VITE_` 前缀该怎么用。

## 生产构建

```bash
npm run build     # 产物输出到 dist/
npm run preview   # 用本地服务器预览构建产物
```

GitHub Pages 部署走 `.github/workflows/deploy.yml`：推送到 `main` 后自动 `npm ci` + `npm run build`，把 `dist/` 发到 https://240000000.github.io/comm-lab/ 。因为站点挂在 `/comm-lab/` 子路径下，`vite.config.ts` 在 build 时把 `base` 设为 `/comm-lab/`，本地开发仍是根路径。

常见问题：

| 现象 | 原因与处理 |
| --- | --- |
| 页面空白 | 打开浏览器控制台看报错，通常是 Node 版本低于 24 |
| 只有线上 404 | Pages 站点在 `/comm-lab/` 子路径下，本地开发不受影响 |
| `npm ci` 失败 | 见第 1 步：删 `node_modules` 改用 `npm install` |

## 目录结构

本节只列当前真实存在的部分，随实现增长。

```
src/             界面（React + TypeScript）
src/core/        通信算法，纯函数，不碰 DOM：
                   qam.ts     星座映射与格雷码标签
                   rng.ts     可复现的伪随机数（mulberry32 + Box–Muller）
                   channel.ts AWGN 加噪与最近距离判决
                   metrics.ts 一次仿真的统计：BER/SER/EVM、实际种子
                   ber.ts     理论误比特率（erfc/Q 函数，Numerical Recipes 拟合）
                   curve.ts   扫 0–20 dB 的误码率曲线
                   conv.ts    卷积码：网格、编码、硬判决与软判决两套 Viterbi、自由距离搜索
                   convCurve.ts 扫三条线（不编码 / 硬判决 / 软判决）
                   dft.ts     按定义算的 64 点 DFT / IDFT（O(N²)，不引快速算法）
                   ofdm.ts    OFDM 链路：QPSK、IFFT、循环前缀、两径信道、频域判决与 EVM
src/labs/        各实验模块的页面与画布组件（QamPage、ConvPage、OfdmPage、ConstellationChart、BerCurveChart、ConvCurveChart、OfdmTimeChart、OfdmSpectrumChart）
tests/           Node 内置 test runner 的单测（npm test）
docs/dialogues/  与 AI 协作的原始 Prompt 存档，按轮次追加
docs/preview.md  作品介绍（给评委看的一两页）
docs/video-script.md  录屏脚本（分段、旁白、屏幕动作）
docs/images/     文档里引用的截图
docs/round-checklist.md  每轮收尾的固定清单
.github/         GitHub Pages 自动部署
public/          静态资源
```

## 技术栈

Vite + React + TypeScript；绘图用 Canvas 2D 手写，不引图表库；FFT 不引库，按定义写 64 点 DFT；单测用 Node 内置 test runner（`npm test`，不加任何测试依赖），当前 82 条用例，覆盖 QAM 星座映射、路由解析、AWGN 加噪与判决、统计口径与可复现性、理论曲线与扫描、卷积码网格与编码、两套 Viterbi 译码、自由距离与纠错能力、DFT/IDFT 往返还原、循环前缀与两径信道；代码检查用 `npm run lint`（oxlint）。全部计算在浏览器内完成。

## 开发与提交约定

- 一次 commit 对应一个可独立描述的功能点，提交信息用 `type(scope): 说明 [R轮次]`。
- 纯文字校订（只改文档措辞、不动功能代码）走例外：单独一个提交，信息写一句中文，不加 `type(scope)` 前缀和轮次标记——它不算功能轮，别和功能提交混在一起。
- 核心算法（QAM 映射、AWGN 加噪、误码率理论曲线、卷积码编码、Viterbi 译码）自行实现，不使用现成通信库。
- 每个模块先写验收判据，再写实现，最后用测试卡住。
