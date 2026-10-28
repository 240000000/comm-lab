/**
 * OFDM 实验台：只演示一件事——循环前缀把多径的拖尾关在 CP 里。
 * 不做信道估计、不做均衡、不做频偏，也不做多天线。
 *
 * 版式（R16 第二批）：上半屏左时域、右接收点；参数压成一条横栏；读数在横栏右端；
 * 长说明默认折叠；页面底部留给结论卡片。
 */
import { useMemo, useState } from 'react'

import { MAX_CP, MAX_DELAY, SUBCARRIERS, runOfdm } from '../core/ofdm.ts'
import { OfdmSpectrumChart } from './OfdmSpectrumChart.tsx'
import { OfdmTimeChart } from './OfdmTimeChart.tsx'
import { FromQuestionNote } from './FromQuestionNote.tsx'
import { OFDM_MAX_SYMBOLS, readOfdmParams } from '../core/labQuestions.ts'

const DEFAULT_SYMBOLS = 200
const DEFAULT_SEED = 20261027
const DEFAULT_CP = 16
const DEFAULT_DELAY = 9

function formatRate(value: number): string {
  if (value === 0) return '0'
  return value.toExponential(2)
}

function readout(errors: number, total: number, unit: string) {
  if (errors === 0) {
    return { value: '这次没出错', count: `0 个${unit}出错 / 共比对 ${total.toLocaleString('en-US')} 个${unit}` }
  }
  return {
    value: formatRate(errors / total),
    count: `错 ${errors.toLocaleString('en-US')} 个${unit} / 共比对 ${total.toLocaleString('en-US')} 个${unit}`,
  }
}

export function OfdmPage() {
  const [initial] = useState(() => readOfdmParams(window.location.hash))
  const [cpLen, setCpLen] = useState(initial.cpLen)
  const [delay, setDelay] = useState(initial.delay)
  const [symbolCount, setSymbolCount] = useState(initial.symbolCount)
  const [fromQuery, setFromQuery] = useState(initial.fromQuery)
  const [seed, setSeed] = useState(DEFAULT_SEED)

  const result = useMemo(
    () => runOfdm({ cpLen, delay, symbolCount, seed }),
    [cpLen, delay, symbolCount, seed],
  )

  const withCp = readout(result.withCp.symbolErrors, result.withCp.symbolCount, ' QPSK 符号')
  const noCp = readout(result.noCp.symbolErrors, result.noCp.symbolCount, ' QPSK 符号')
  const echoInCp = delay <= cpLen
  const intrude = result.wave.intrudingSamples

  return (
    <main className="lab lab-ofdm">
      <a className="back" href="#/">
        ← 返回首页
      </a>

      <p className="eyebrow">OFDM 时频链路</p>
      <h1>循环前缀到底挡住了什么</h1>
      <p className="lede">
        一条主径，加一条延时径。把延时慢慢拉过 CP 的长度：CP 之内，多径的拖尾落在前缀里，数据段是干净的；CP
        之外，拖尾压进数据段，码间干扰就来了。左边是时域，右边是 64 个子载波上的接收点，
        两条支路的错号数在下面横栏的右端。
      </p>

      {fromQuery && (
        <FromQuestionNote
          text={`这组参数来自任务模式「你自己出题」：OFDM · CP ${cpLen} · 延时 ${delay} · ${symbolCount} 符号。已经原样回填；改动控件后这组参数就归你了。`}
          onRestore={() => {
            setCpLen(DEFAULT_CP)
            setDelay(DEFAULT_DELAY)
            setSymbolCount(DEFAULT_SYMBOLS)
            setFromQuery(false)
            history.replaceState(null, '', '#/ofdm')
          }}
        />
      )}

      <section className="ofdm-stage">
        <div className="ofdm-panel ofdm-time">
          <h2 className="section-head">一个 OFDM 符号的时域波形</h2>
          <OfdmTimeChart wave={result.wave} />
        </div>

        <div className="ofdm-panel ofdm-space">
          <div className="ofdm-space-head">
            <h2 className="section-head">64 个子载波上的接收点</h2>
            <p className="ofdm-caption">空心方框是 QPSK 的理想位置；点贴着方框，就说明这个子载波没被码间干扰碰到。</p>
          </div>
          <div className="spectrum-pair">
            <div>
              <p className="spectrum-title">有 CP · 误符号率 {withCp.value}</p>
              <OfdmSpectrumChart
                points={result.withCp.constellation}
                accent="#3ce3c6"
                hasError={result.withCp.symbolErrors > 0}
              />
            </div>
            <div>
              <p className="spectrum-title">没有 CP · 误符号率 {noCp.value}</p>
              <OfdmSpectrumChart
                points={result.noCp.constellation}
                accent="#ffb054"
                hasError={result.noCp.symbolErrors > 0}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="ofdm-bar" aria-label="OFDM 参数与两条支路的读数">
        <div className="ofdm-bar-item">
          <label className="ofdm-bar-label" htmlFor="cp-len">
            <span>循环前缀长度 CP</span>
            <strong>{cpLen} 个采样</strong>
          </label>
          <input
            id="cp-len"
            type="range"
            min={0}
            max={MAX_CP}
            step={1}
            value={cpLen}
            onChange={(event) => setCpLen(Number(event.target.value))}
          />
        </div>

        <div className="ofdm-bar-item">
          <label className="ofdm-bar-label" htmlFor="delay">
            <span>延时径的延时</span>
            <strong>{delay} 个采样</strong>
          </label>
          <input
            id="delay"
            type="range"
            min={0}
            max={MAX_DELAY}
            step={1}
            value={delay}
            onChange={(event) => setDelay(Number(event.target.value))}
          />
        </div>

        <div className="ofdm-bar-item ofdm-bar-num">
          <label className="ofdm-bar-label" htmlFor="symbol-count">
            <span>统计符号数</span>
            <strong>{symbolCount} 个</strong>
          </label>
          <input
            id="symbol-count"
            type="number"
            min={1}
            max={OFDM_MAX_SYMBOLS}
            step={1}
            value={symbolCount}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isInteger(next) && next >= 1 && next <= OFDM_MAX_SYMBOLS) setSymbolCount(next)
            }}
          />
        </div>

        <div className="ofdm-bar-item ofdm-bar-seed">
          <label className="ofdm-bar-label" htmlFor="seed">
            <span>随机种子</span>
            <strong>{seed}</strong>
          </label>
          <div className="seed-row">
            <input
              id="seed"
              type="number"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value) || DEFAULT_SEED)}
            />
            <button type="button" className="ghost" onClick={() => setSeed((value) => value + 1)}>
              换一颗
            </button>
          </div>
        </div>

        <div className="ofdm-bar-readouts">
          <div className="ofdm-ro">
            <span className="ofdm-ro-title">有 CP</span>
            <strong className="ofdm-ro-value">{withCp.value}</strong>
            <span className="ofdm-ro-count">{withCp.count}</span>
            <span className="ofdm-ro-evm">EVM {result.withCp.evmPercent.toFixed(1)}%</span>
          </div>
          <div className="ofdm-ro">
            <span className="ofdm-ro-title">没有 CP</span>
            <strong className="ofdm-ro-value">{noCp.value}</strong>
            <span className="ofdm-ro-count">{noCp.count}</span>
            <span className="ofdm-ro-evm">EVM {result.noCp.evmPercent.toFixed(1)}%</span>
          </div>
        </div>
      </section>

      <p className="ofdm-dyn">
        {echoInCp
          ? `延时 ${delay} ≤ CP ${cpLen}：拖尾整个落在前缀里，数据段没有被压到。`
          : `延时 ${delay} > CP ${cpLen}：拖尾压进数据段 ${intrude} 个采样，码间干扰从这里开始。`}
      </p>

      <details className="ofdm-guide">
        <summary>怎么读这两张图</summary>
        <p>
          横轴是一个符号的 {SUBCARRIERS + cpLen} 个采样：左边 {cpLen} 个是 CP（浅色底），右边 {SUBCARRIERS}{' '}
          个是数据段。青线和灰线在哪里分开，就说明延时径在那里咬了进来。延时 ≤ CP 时，分开的地方全在底色里；
          延时 &gt; CP 时，分开的地方会挪进数据段——也就是码间干扰真正发生的位置。
        </p>
        <p>
          接收点图里，空心方框是 QPSK 的四个理想位置，实心点是最后一个符号解出来的 64 个接收点。点都按各自子载波归一过，
          所以「点贴在方框上」= 那个子载波没有被码间干扰碰过。右边那张是没有 CP 的支路，用来对照。
        </p>
      </details>

      <details className="ofdm-params">
        <summary>参数与口径</summary>
        <dl className="params">
          <div>
            <dt>子载波数</dt>
            <dd>{SUBCARRIERS}（刚好一个符号 64 个采样）</dd>
          </div>
          <div>
            <dt>调制</dt>
            <dd>QPSK，每子载波 2 比特</dd>
          </div>
          <div>
            <dt>延时径幅度</dt>
            <dd>0.5（功率是主径的 1/4，不会两径抵消）</dd>
          </div>
          <div>
            <dt>统计样本</dt>
            <dd>
              {symbolCount.toLocaleString('en-US')} 个符号 / {result.withCp.symbolCount.toLocaleString('en-US')} 个 QPSK 符号
            </dd>
          </div>
          <div>
            <dt>变换</dt>
            <dd>按定义算的 64 点 DFT / IDFT</dd>
          </div>
        </dl>
      </details>

      <section className="notes">
        <article className="note-card">
          <h2>CP 消的是码间干扰，不是衰落</h2>
          <p>
            两径信道在频域是一个有起伏的传输函数：有些子载波被抬高，有些被压低。CP 动的只是「前后符号会不会互相压到」，
            动不了这条曲线。这里是 QPSK 才显得无所谓——四个点只看象限，幅度和相位被改一改也常常还在原来的象限里。
            换成更高阶的调制、或者要判幅度的时候，就得做信道估计与均衡了，那是这个页面没做的部分。
          </p>
        </article>
        <article className="note-card">
          <h2>这个页面里没有噪声</h2>
          <p>
            链路里只有两条径，没有加高斯白噪声。所以这里的误符号率全是码间干扰贡献的：延时在 CP 之内时它正好是 0，
            不是「信噪比很高」，而是「压根没往里加噪声」。
          </p>
        </article>
        <article className="note-card">
          <h2>延时的吸收范围就是 CP 的长度</h2>
          <p>
            一条延时为 d 个采样的径，会把上一个符号的最后 d 个采样拖到当前符号开头。CP 有 c 个采样，只要 d ≤ c，
            这 d 个采样就全落在前缀里，丢掉前缀等于扔掉它们。d 一旦大于 c，多出来的 d − c 个采样就压进数据段，
            有 CP 那边也开始出错——CP 不是永久免疫，它只是把可容忍的延时抬到了 c。
          </p>
        </article>
      </section>
    </main>
  )
}
