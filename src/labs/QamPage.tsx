/**
 * QAM 实验台页面。
 *
 * 页面上的数字全部来自 src/core 里的纯函数：
 * 选阶数、拖滑块 → 重跑一次「发—加噪—判」→ 重画点云、重写读数、重扫整条曲线。
 * 没有一个数字是手写死的，也没有任何后端或第三方库参与。
 */
import { useMemo, useState } from 'react'
import { BerCurveChart } from './BerCurveChart'
import { ConstellationChart } from './ConstellationChart'
import { sweepBer } from '../core/curve'
import { simulateAwgn } from '../core/metrics'
import { QAM_ORDERS, bitsPerSymbol, orderLabel } from '../core/qam'
import { CommandPanel } from './CommandPanel'

/** 默认档位，与任务模式那道数值题、指令面板的「重置」保持一致。 */
const DEFAULT_ORDER = 16
/** 一次统计用多少个符号：20,000 个符号 × 每符号比特数。 */
const SYMBOLS = 20000
/** 曲线每个信噪比点也用同一规模，保证能用同样的分母读。 */
const CURVE_SYMBOLS = 20000
const FROM_DB = 0
const TO_DB = 20

/**
 * 读数拆成两行：上面是比值，下面是「错几个 / 一共几个」。
 * 分母必须和数字一起出现——「1e-5」在 8 万个比特和 12 万个比特下的可信度完全不同。
 */
function rateReadout(errors: number, total: number, unit: string, ratio: number) {
  const totalText = total.toLocaleString('en-US')
  if (errors === 0) {
    return { value: '这次没出错', count: `0 个${unit}出错 / 共比对 ${totalText} 个${unit}` }
  }
  const errorsText = errors.toLocaleString('en-US')
  return { value: ratio.toExponential(2), count: `错 ${errorsText} 个${unit} / 共比对 ${totalText} 个${unit}` }
}

export function QamPage() {
  const [order, setOrder] = useState(DEFAULT_ORDER)
  const [snrDb, setSnrDb] = useState(12)
  const [seed, setSeed] = useState(20261027)

  const bits = bitsPerSymbol(order)

  const stats = useMemo(
    () => simulateAwgn({ order, snrDb, symbolCount: SYMBOLS, seed }),
    [order, snrDb, seed],
  )

  const curve = useMemo(
    () =>
      sweepBer({
        order,
        fromDb: FROM_DB,
        toDb: TO_DB,
        stepDb: 1,
        symbolCount: CURVE_SYMBOLS,
        seed,
      }),
    [order, seed],
  )

  const resolution = 1 / stats.bitCount
  const zeroBitErrors = stats.bitErrors === 0
  const berReadout = rateReadout(stats.bitErrors, stats.bitCount, '比特', stats.ber)
  const serReadout = rateReadout(stats.symbolErrors, stats.symbolCount, '符号', stats.ser)

  return (
    <main className="lab">
      <a className="back" href="#/">
        ← 返回首页
      </a>

      <header className="lab-head">
        <p className="eyebrow">QAM 星座实验台</p>
        <h1>星座点为什么会被噪声推离原位</h1>
        <p className="lede">
          一个符号发出去，加多少噪声、收端怎么判、错了多少比特——这条链上的每一步都在下面。
          先挑一档阶数，再拖右边的信噪比，看左边的点怎么糊开，再看底下的读数怎么跟着变。
        </p>
      </header>

      <div className="lab-layout">
        <section className="chart-block" aria-label="星座图与点云">
          <ConstellationChart order={order} received={stats.received} snrDb={snrDb} />
        </section>

        <aside className="controls" aria-label="实验参数">
          <div className="control">
            <span className="control-label">
              星座阶数
              <strong>{orderLabel(order)}</strong>
            </span>
            <div className="order-row" role="group" aria-label="星座阶数">
              {QAM_ORDERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === order ? 'order-btn active' : 'order-btn'}
                  aria-pressed={option === order}
                  onClick={() => setOrder(option)}
                >
                  {orderLabel(option)}
                </button>
              ))}
            </div>
            <span className="control-hint">
              换阶数会重算星座、三个读数和整条 0–20 dB 曲线；种子和信噪比保留不动。
            </span>
          </div>

          <label className="control">
            <span className="control-label">
              信噪比 Es/N0
              <strong>{snrDb.toFixed(1)} dB</strong>
            </span>
            <input
              type="range"
              min={FROM_DB}
              max={TO_DB}
              step={0.5}
              value={snrDb}
              onChange={(event) => setSnrDb(Number(event.target.value))}
            />
            <span className="control-hint">
              0 dB：噪声和信号差不多大，点几乎认不出原来是谁。20 dB：几乎贴着理想点。
            </span>
          </label>

          <div className="control">
            <span className="control-label">
              随机种子
              <strong>{seed}</strong>
            </span>
            <div className="seed-row">
              <input
                type="number"
                value={seed}
                min={0}
                step={1}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isInteger(next) && next >= 0) setSeed(next)
                }}
              />
              <button
                type="button"
                onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
              >
                换一颗
              </button>
            </div>
            <span className="control-hint">
              同一颗种子、同一个信噪比，重跑出来的点和读数逐位相同。本次实际用的种子是{' '}
              {stats.seedUsed.toLocaleString('en-US')}（由种子与信噪比共同派生）。
            </span>
          </div>

          <CommandPanel
            order={order}
            snrDb={snrDb}
            onSnrChange={setSnrDb}
            onOrderChange={setOrder}
            onRerun={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
            onReset={() => {
              setOrder(DEFAULT_ORDER)
              setSnrDb(12)
              setSeed(20261027)
            }}
          />

          <dl className="params">
            <div>
              <dt>调制</dt>
              <dd>
                {orderLabel(order)}（每符号 {bits} 比特）
              </dd>
            </div>
            <div>
              <dt>统计样本</dt>
              <dd>
                {SYMBOLS.toLocaleString('en-US')} 个符号 / {stats.bitCount.toLocaleString('en-US')} 个比特
              </dd>
            </div>
            <div>
              <dt>判决方式</dt>
              <dd>最近欧氏距离（接收点离哪个理想点最近就判成谁）</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="readouts" aria-label="统计读数">
        <article className="readout">
          <h2>误码率 BER</h2>
          <p className="readout-value">{berReadout.value}</p>
          <p className="readout-count">{berReadout.count}</p>
          <p className="readout-note">
            判错的比特数 ÷ 一共比对的比特数。{zeroBitErrors && `这批样本只说明错得比 ${resolution.toExponential(1)} 还少，不等于真的一个都不会错。`}
          </p>
        </article>

        <article className="readout">
          <h2>误符号率 SER</h2>
          <p className="readout-value">{serReadout.value}</p>
          <p className="readout-count">{serReadout.count}</p>
          <p className="readout-note">
            {bits === 1
              ? '每符号只有 1 比特，所以误符号率和误比特率必然是同一个数——这不是巧合，也不是重复显示。'
              : `一个符号里 ${bits} 个比特，所以 SER 通常比 BER 大。`}
          </p>
        </article>

        <article className="readout">
          <h2>误差向量幅度 EVM</h2>
          <p className="readout-value">{stats.evmPercent.toFixed(2)}%</p>
          <p className="readout-count">
            {stats.symbolCount.toLocaleString('en-US')} 个符号的均方根误差 / 理想点平均幅度
          </p>
          <p className="readout-note">
            每个接收点离理想点有多远，取均方根，再除以理想点的平均幅度。它不看判决对错，只看「偏了多少」；
            噪声功率只看 Es/N0，所以同一信噪比下换阶数，EVM 不变。
          </p>
        </article>
      </section>

      <section className="curve-block" aria-label="误码率曲线">
        <header className="section-head">
          <h2>0–20 dB 扫一遍</h2>
          <p>
            21 个信噪比点，每点 {CURVE_SYMBOLS.toLocaleString('en-US')} 个符号（
            {(CURVE_SYMBOLS * bits).toLocaleString('en-US')} 个比特），种子相同。整条曲线在本机 40–80 ms
            算完，所以换阶数、拖滑块时不会卡。
          </p>
        </header>
        <BerCurveChart points={curve} fromDb={FROM_DB} toDb={TO_DB} order={order} />
      </section>
    </main>
  )
}
