# 通信原理交互实验室

> 拖一下滑块，就能看见 QAM 星座、卷积码译码和 OFDM 时频链怎么变——不需要 MATLAB，不需要装环境，打开浏览器就行。

**在线 Demo：** https://240000000.github.io/comm-lab/

> 当前进度：`v0.1` 骨架已上线，四个实验模块正在逐个实现。页面打不开即为构建失败，请提 issue。

## 截图

> 截图位：每完成一个模块在此替换为实际运行截图（`docs/images/qam.png` 等）。

| QAM 星座实验台 | 卷积码与 Viterbi | OFDM 时频链 | 任务模式 |
| --- | --- | --- | --- |
| _待补_ | _待补_ | _待补_ | _待补_ |

## 十分钟跑起来

前置条件：Node.js ≥ 20.19（或 ≥ 22.12）、npm ≥ 10。无需后端、无需数据库、无需 API Key。

```bash
# 1. 克隆
git clone https://github.com/240000000/comm-lab.git
cd comm-lab

# 2. 安装依赖（约 30 秒）
npm ci

# 3. 启动开发服务器
npm run dev
# 终端会打印 http://localhost:5173/ ，浏览器打开即可
```

生产构建与本地预览：

```bash
npm run build     # 产物输出到 dist/
npm run preview   # 预览构建产物
```

常见问题：

| 现象 | 原因与处理 |
| --- | --- |
| `npm ci` 报 lockfile 不一致 | 删除 `node_modules` 后改用 `npm install` |
| 页面空白 | 打开浏览器控制台看报错，通常是 Node 版本过低 |
| 404 于 `/comm-lab/` 资源 | 只在 GitHub Pages 上出现，本地开发不受影响 |

## 目录结构

```
src/
├─ core/       纯函数算法层（QAM、AWGN、FFT、卷积码、Viterbi、OFDM），零 DOM，可单测
├─ components/ 绘图与控件（Plot、Slider、Panel 等）
├─ labs/       四个实验模块的页面装配
└─ app/        路由、布局、状态
docs/
├─ dialogues/  与 AI 的原始 Prompt 链存档（按轮次，原文不修饰）
└─ ...         架构、意图控制方法、测试报告
```

## 技术栈

Vite + React + TypeScript，Canvas 2D 手写绘图，Vitest 单测，GitHub Actions 自动部署到 Pages。全部计算在浏览器内完成。

## 开发与提交约定

- 一次 commit 对应一个可独立描述的功能点或一次修复，提交信息用 `type(scope): 说明`。
- 核心算法（QAM 映射、AWGN、FFT、卷积码、Viterbi、OFDM 收发链）自行实现，不使用现成通信库。
- 每个模块先写验收判据，再写实现，最后用测试卡住——见 `docs/intent-control.md`（待补）。
