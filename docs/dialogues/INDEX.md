# 对话存档索引

一场对话一个文件，按轮次分节往后追加。每轮对应一个 commit 和一个 annotated tag，`git show R1` 可以直接看当轮的全部改动。

| 轮次 | 日期 | tag | 提交标题 | 改动文件 |
| --- | --- | --- | --- | --- |
| R1 | 2026-10-26 | `R1` | docs(process): README 复现三段、无密钥模板与 R1 对话存档 [R1] | `README.md`、`.env.example`、`package.json`、`docs/dialogues/2026-10-26-session-02.md`、`docs/dialogues/INDEX.md` |

## 约定

- 存档文件里的对话逐字照录，包括 AI 的话，不改写、不归纳。
- 文件清单从 `git diff --cached --stat` 的真实输出粘贴，与提交后 `git show --stat HEAD` 一致。
- 命令输出、验收结果留在对话记录里，不进存档。
- tag 与 commit 一起推：`git push --tags`。
