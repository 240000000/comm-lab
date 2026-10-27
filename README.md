# 通信原理交互实验室

> 拖一下滑块，就能看见 QAM 星座、卷积码译码和 OFDM 时频链怎么变——不需要 MATLAB，不需要装环境，打开浏览器就行。
>
> 现在到哪一步了：首页能用，QAM 页能拖信噪比滑块，看 16QAM 点云怎么糊开，底下给出误码率、误符号率、EVM 三个读数，再往下是 0–20 dB 的误码率曲线和理论对照；卷积码页也接通了，一条 12 比特短序列把「原始 → 编码 → 加噪 → 译码」四行摊开，可以关噪声、手动翻位，下面同样是误码率对照曲线。OFDM 与任务模式还没开始。

**在线 Demo：** https://240000000.github.io/comm-lab/

> 当前版本 `v0.5`：卷积码接通——编码器、硬判决与软判决两套独立 Viterbi 译码器、三条线的对照曲线，首页两张卡可点。状态见下面「打开之后点什么」。

## 这个项目是什么

通信原理课上的 QAM 星座、误码率、卷积码、OFDM，平时都是一页公式，换个信噪比就得重新算。这个项目把它们做成能拖的页面：调信噪比、调阶数、开关循环前缀，图上立刻能看到星座点散开、误码率抬起来、符号开始互相干扰。

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

### 3. 打开之后点什么

打开终端给出的那个地址，首页是四个实验模块的入口卡：

| 卡片 | 现在能做什么 |
| --- | --- |
| QAM 星座实验台 | 拖信噪比滑块（0–20 dB）看点云散开，读误码率/误符号率/EVM（都带分母），下方是 0–20 dB 误码率曲线与理论对照 |
| 卷积码与 Viterbi | 12 比特短序列四行对照（原始/编码/加噪/译码），可关噪声、手动翻 1/2/4 位看纠得回还是纠不回；下方是 0–10 dB 三条线：不编码、硬判决、软判决 |
| OFDM 时频链路 | 待开始 |
| 任务模式 | 待开始 |

模块逐个接入，接通一个就改这张表里的一行。QAM 页的地址是 `#/qam`，卷积码页是 `#/conv`，首页是 `#/`，直接敲进地址栏或刷新都停在同一页。

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
src/labs/        各实验模块的页面与画布组件（QamPage、ConvPage、ConstellationChart、BerCurveChart、ConvCurveChart）
tests/           Node 内置 test runner 的单测（npm test）
docs/dialogues/  与 AI 协作的原始 Prompt 存档，按轮次追加
.github/         GitHub Pages 自动部署
public/          静态资源
```

## 技术栈

Vite + React + TypeScript；绘图用 Canvas 2D 手写，不引图表库；单测用 Node 内置 test runner（`npm test`，不加任何测试依赖），当前 68 条用例，覆盖 QAM 星座映射、路由解析、AWGN 加噪与判决、统计口径与可复现性、理论曲线与扫描、卷积码网格与编码、两套 Viterbi 译码、自由距离与纠错能力；代码检查用 `npm run lint`（oxlint）。全部计算在浏览器内完成。

## 开发与提交约定

- 一次 commit 对应一个可独立描述的功能点，提交信息用 `type(scope): 说明 [R轮次]`。
- 核心算法（QAM 映射、AWGN、FFT、卷积码、Viterbi、OFDM 收发链）自行实现，不使用现成通信库。
- 每个模块先写验收判据，再写实现，最后用测试卡住。
