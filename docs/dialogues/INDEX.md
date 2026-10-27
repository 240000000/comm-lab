# 对话存档索引

一场对话一个文件，按轮次分节往后追加。每轮对应一个 commit 和一个 annotated tag，`git show R1` 可以直接看当轮的全部改动。

| 轮次 | 日期 | tag | 提交 | 这轮做了什么 |
| --- | --- | --- | --- | --- |
| R1 | 2026-10-26 | `R1` | `c2d04a0` | docs(process)：README 复现三段、无密钥模板、对话存档与 INDEX（5 文件 +284/−29） |
| R2 修正 | 2026-10-26 | —（不动 R1 tag） | `3be4d19` | fix(docs)：存档按对话原文更正 4 处措辞，不 amend、不重打 tag |
| R2 | 2026-10-26 | `R2` | `cab1754` | feat(route)：手写 hash 路由，首页四卡中 QAM 可点，QAM 页只有标题/说明/返回/占位 |
| R2 补录 | 2026-10-27 | — | `972ec1c` | fix(docs)：R2 节 AI 侧原文由用户落盘后逐字补入，替换「原文缺失」占位 |
| R3 | 2026-10-27 | `R3` | `bb24983` | feat(qam)：`src/core/qam.ts` 星座映射 + 21 条 node 自带测试 + 静态 16QAM 星座图（8 文件 +591/−14；此前两笔 `972ec1c`/`b5ac90a` 为存档与 hover 修正） |

## 约定

- 存档文件里的对话照录原话，不改写、不归纳、不润色；拿不到原文的段落标「原文缺失」，不补写。
- 文件清单从 `git diff --cached --stat` 的真实输出粘贴，与提交后 `git show --stat HEAD` 一致。
- 命令输出、验收结果留在对话记录里，不进存档。
- 每轮一个 commit、一个 annotated tag，提交信息带 `[Rn]`；tag 与 commit 一起推：`git push --tags`。
