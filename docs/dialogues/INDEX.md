# 对话存档索引

一场对话一个文件，按轮次分节往后追加。每轮对应一个 commit 和一个 annotated tag，`git show R1` 可以直接看当轮的全部改动。

| 轮次 | 日期 | tag | 提交 | 这轮做了什么 |
| --- | --- | --- | --- | --- |
| R1 | 2026-10-26 | `R1` | `c2d04a0` | docs(process)：README 复现三段、无密钥模板、对话存档与 INDEX（5 文件 +284/−29） |
| R2 修正 | 2026-10-26 | —（不动 R1 tag） | `3be4d19` | fix(docs)：存档按对话原文更正 4 处措辞，不 amend、不重打 tag |
| R2 | 2026-10-26 | `R2` | `cab1754` | feat(route)：手写 hash 路由，首页四卡中 QAM 可点，QAM 页只有标题/说明/返回/占位 |
| R2 补录 | 2026-10-27 | — | `972ec1c` | fix(docs)：R2 节 AI 侧原文由用户落盘后逐字补入，替换「原文缺失」占位 |
| R3 | 2026-10-27 | `R3` | `bb24983` | feat(qam)：`src/core/qam.ts` 星座映射 + 21 条 node 自带测试 + 静态 16QAM 星座图（8 文件 +591/−14；此前两笔 `972ec1c`/`b5ac90a` 为存档与 hover 修正） |
| R4 | 2026-10-27 | `R4` | `c27b5c6` | feat(qam)：加噪链路（rng/channel/metrics/ber/curve 五个纯函数模块）、滑块与点云、BER/SER/EVM 读数、0–20 dB 误码率曲线，44 条测试（15 文件 +1427/−144） |
| R4 补漏 | 2026-10-27 | —（不打 tag） | `88bdacf` | fix：补上本表 R4 行、把收尾动作落成 `docs/round-checklist.md`、星座图 I/Q 标注压到云团之上 |
| R5 | 2026-10-27 | `R5` | `58eb41f` | feat(conv)：卷积码编码器（约束长度 3、7/5、补零）、硬判决与软判决两套 Viterbi、自由距离与纠错能力、12 比特四行短序列页、0–10 dB 三条线对照，68 条测试（12 文件 +1541/−13） |
| R6 | 2026-10-27 | `R6` | 见 `R6` tag | docs：首页「能调阶数」一句改口、`docs/preview.md`、`docs/video-script.md`、三张图入仓 `docs/images/`、README 补干净目录实测耗时（克隆 4.8 s、`npm ci` 2.6 s、`npm test` 0.6 s） |
| R7 | 2026-10-27 | `R7` | 见 `R7` tag | docs：preview 第六节「2 dB 差一个数量级」按实测重写为 4 dB 的 203 / 11，判据 ≥18→≥21、翻四位错位数 1→3、20 dB 补 EVM 9.99%，video-script 三处同类改口；并加「本文件对应 tag R7」一行 |

## 约定

- 存档文件里的对话照录原话，不改写、不归纳、不润色；拿不到原文的段落标「原文缺失」，不补写。
- 文件清单从 `git diff --cached --stat` 的真实输出粘贴，与提交后 `git show --stat HEAD` 一致。
- 命令输出、验收结果留在对话记录里，不进存档。
- 每轮一个 commit、一个 annotated tag，提交信息带 `[Rn]`；tag 与 commit 一起推：`git push --tags`。
- 每轮收尾照着 [`../round-checklist.md`](../round-checklist.md) 走一遍；其中「补这张表」是固定项，此前漏过两次。
