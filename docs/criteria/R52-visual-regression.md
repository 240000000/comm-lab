# R52 视觉与读数回归判据（双站对照法）

> 这份判据解决一件事：改了交互层（滑块、数值框、图表位图）之后，怎么证明「读数一个没变」。
> 只靠人眼看截图不算证据——同一屏在 125% 缩放下像素位置都会动，读数却必须一字不差。

## 一、双站对照法

同一份 CDP 脚本，同时对着**两个本地静态站点**读 DOM，逐档比对文本。

1. 起基线站：`git worktree add /d/harness/tmp/base-r51 R51`，在里面 `npm ci && npm run build`，把 `dist` 复制到 `/d/harness/tmp/site2/comm-lab`。
2. 起现役站：仓库根 `npm run build`，把 `dist` 复制到 `/d/harness/tmp/site/comm-lab`。
3. 两个端口各起一个静态服务器：`python -m http.server 8011 --bind 127.0.0.1`（现役，cwd `/d/harness/tmp/site`）与 `http://127.0.0.1:8012`（基线，cwd `/d/harness/tmp/site2`）。**端口不同、路径相同**，页面里的相对资源才不会一边 404。
4. 有头浏览器 + CDP `9223`，脚本用 `Page.bringToFront` 与 `Emulation.setFocusEmulationEnabled` 两行保证页面不是 `hidden`（否则输入事件会挂 5 秒一条）；切站用 `Page.navigate` 到另一个端口，**不要**只改 hash（`Page.navigate` 到只有 hash 不同的同一 URL 不会重载文档，页面内监听器会累加）。
5. 两个站跑完全相同的参数档位，把结果写成 `{选择器: 文本}` 两个对象，逐键比对，输出 `mismatches`。

「一个常量宽、一个现宽」的意思是：基线站把窗口固定成设计宽度（1440）跑一遍，现役站用当前真实窗口（含 125% 缩放、`dpr = 1.25`）跑一遍。这样比对的是**同一组参数下的读数**，而不是同一块屏幕的像素。

## 二、四条判据

1. **读数逐字一致**：同一组参数下，两站每个读数选择器的文本完全相同（`mismatches 0`）。差一个字符都算不通过，包括 `1.00` 与 `1.0` 这种尾零差异。
2. **位图只在尺寸真变时重分配**：`canvas.width / canvas.height` 属性等于 CSS 尺寸 × `dpr`（1440 宽、`dpr 1.25` 时 320 高的画布属性高是 400）。窗口从宽改窄再改回，位图尺寸回到原值；拖动滑块过程中尺寸不变。
3. **数值框语义**：输入过程中的中间态不提交（读数不动）；`Enter` 或失焦才提交；越界夹到 `min / max`；按 `step` 对齐；空串、非数字、`Escape` 一律回退到上一个有效值。
4. **同值等价**：把参数拖到某个值、与直接在数值框输入同一个值，两种路径产出的读数与曲线完全一致（拖动路径走 rAF 合帧与隔帧节流，松手必须用最后一次完整参数补算，不能留下被省掉的中间态）。

## 三、选择器清单

读数区（每页不同，按页取全）：

| 选择器 | 出现在哪 |
| --- | --- |
| `.readout-value` | QAM 页三个读数 |
| `.ofdm-ro-value` / `.ofdm-ro-count` / `.ofdm-ro-evm` | OFDM 页读数 |
| `.bit-row-hint` / `.sequence-status` | 卷积码页的逐位提示与结论 |
| `.spectrum-title` | OFDM 频谱标题（含延时径档位） |
| `.course-readouts .readout-value` | 课程视图 13 章读数 |
| `.course-conclusion p` | 课程视图结论句 |
| `.course-params select` | 课程视图的档位下拉（值不是文本，取 `value`） |

**不要取 `.control-label`**：它把「参数名 + 当前值」写在同一行，值一改整行就变，会造出几十处假 DIFF。要取参数当前值，取滑块 `input[type=range]` 的 `value`。

## 四、常见的假阳性

- 只读 `.readout-value` 就去比 OFDM 与卷积页，会把「读不到」当成「不一致」（这两页的选择器是上表第二、三行）。R52 第一次对照就是这么翻车的，补齐选择器后才拿到 0 处不符。
- 用无头浏览器比手感：无头下 `requestAnimationFrame` 被钳到约 7 ms，`p50 / p95` 一律饱和，分辨不出快慢。手感要量就上有头浏览器。
- 拿 `console` 里的 GBK 乱码当文件损坏：Windows 控制台按 GBK 解码 UTF-8 输出，文件本身没问题。
