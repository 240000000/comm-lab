/**
 * 信道编码页。
 *
 * 上半页：一条十来个比特的短序列，把「原始 → 编码 → 加噪 → 译码」四行摊开看。
 *   可以关掉噪声看纯净对照，也可以手动翻几位，看译码器到底纠得回还是纠不回。
 * 下半页：0–10 dB 扫一遍，不编码 / 硬判决 / 软判决三条线画在一起。
 *
 * 所有数字都来自 src/core 的纯函数，页面不自己算概率、不自己编结果。
 */
import { useMemo, useState } from 'react'
import { ConvCurveChart } from './ConvCurveChart'
import { sweepConv } from '../core/convCurve'
import { createRng } from '../core/rng'
import {
  correctionCapability,
  decodeHard,
  decodeSoft,
  encodeConvolutional,
  freeDistance,
  sliceHard,
  transmit,
} from '../core/conv'
import { deriveSeed } from '../core/metrics'
import { FromQuestionNote } from './FromQuestionNote'
import { ShortFilm } from './ShortFilm'
import { CONV_MAX_INFO_BITS, readConvParams } from '../core/labQuestions'

/** 短序列默认信息比特数；上限与页面能摆开的格子数一致。 */
const DEFAULT_INFO_BITS = 12
const DEMO_SEED = 20261027
const CURVE_BITS = 20000
const FROM_DB = 0
const TO_DB = 8
const CURVE_TO_DB = 10

/** 手动翻位的位置。分开翻两位是能纠回的情形，翻一片四位是把码距撑破的情形。 */
const FLIP_SETS: Record<'none' | 'one' | 'two' | 'burst', number[]> = {
  none: [],
  one: [3],
  two: [3, 17],
  burst: [12, 13, 14, 15],
}

type FlipKey = keyof typeof FLIP_SETS

type Tone = 'plain' | 'error' | 'tail' | 'wrong'

/** 一行比特的展示：每个格子一位，按 tone 上色。 */
function BitRow({
  label,
  hint,
  bits,
  tones,
}: {
  label: string
  hint?: string
  bits: number[]
  tones: Tone[]
}) {
  return (
    <div className="bit-row">
      <div className="bit-row-head">
        <span className="bit-row-label">{label}</span>
        {hint && <span className="bit-row-hint">{hint}</span>}
      </div>
      <div className="bit-cells">
        {bits.map((bit, index) => (
          <span key={index} className={`bit-cell ${tones[index] ?? 'plain'}`}>
            {bit}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ConvPage() {
  const [initial] = useState(() => readConvParams(window.location.hash))
  const [ebN0, setEbN0] = useState(initial.ebN0)
  const [infoBits, setInfoBits] = useState(initial.infoBits)
  const [fromQuery, setFromQuery] = useState(initial.fromQuery)
  const [noiseOn, setNoiseOn] = useState(initial.noise)
  const [seed, setSeed] = useState(DEMO_SEED)
  const [flipKey, setFlipKey] = useState<FlipKey>('none')
  const [decoder, setDecoder] = useState<'hard' | 'soft'>('hard')

  const demo = useMemo(() => {
    const bitsRng = createRng(seed)
    const bits: number[] = []
    for (let i = 0; i < infoBits; i += 1) bits.push(bitsRng.next() > 0.5 ? 1 : 0)

    const encoded = encodeConvolutional(bits)
    // 码率 1/2：同样的 Eb/N0 下，每个码符号只有一半能量。
    const esN0 = ebN0 + 10 * Math.log10(0.5)
    const sigma = noiseOn ? Math.sqrt(1 / (2 * Math.pow(10, esN0 / 10))) : 0
    const noiseRng = createRng(deriveSeed(seed, ebN0))

    // 接收幅度：BPSK 映射后过噪声。手动翻位就把那几位的幅度取反——
    // 硬判决看到的是「认错了」，软判决看到的是「幅度被推到了另一边」，两者信息量不同。
    const flips = FLIP_SETS[flipKey]
    const received = transmit(encoded.coded, sigma, noiseRng).map((value, index) =>
      flips.includes(index) ? -value : value,
    )
    const sliced = received.map(sliceHard)
    const decoded = decoder === 'hard' ? decodeHard(sliced) : decodeSoft(received)
    const info = decoded.slice(0, bits.length)

    return {
      bits,
      coded: encoded.coded,
      tailBits: encoded.tailBits,
      received,
      sliced,
      decoded: info,
      codedErrors: sliced.reduce((sum, bit, index) => sum + (bit === encoded.coded[index] ? 0 : 1), 0),
      infoErrors: info.reduce((sum, bit, index) => sum + (bit === bits[index] ? 0 : 1), 0),
    }
  }, [ebN0, noiseOn, seed, flipKey, decoder, infoBits])

  const curve = useMemo(
    () =>
      sweepConv({
        fromDb: FROM_DB,
        toDb: CURVE_TO_DB,
        stepDb: 1,
        bits: CURVE_BITS,
        seed: DEMO_SEED,
      }),
    [],
  )

  const freed = useMemo(() => freeDistance(), [])
  const correctable = correctionCapability(freed.distance)
  const flipCount = FLIP_SETS[flipKey].length
  const allOk = demo.infoErrors === 0

  // 加噪后那一行：跟编码后不一致的位标红。
  const noisyTones: Tone[] = demo.sliced.map((bit, index) =>
    bit === demo.coded[index] ? 'plain' : 'error',
  )
  // 译码后那一行：跟原始比特不一致的位标红。
  const decodedTones: Tone[] = demo.decoded.map((bit, index) =>
    bit === demo.bits[index] ? 'plain' : 'wrong',
  )

  return (
    <main className="lab lab-conv">
      <a className="back" href="#/">
        ← 返回首页
      </a>

      <header className="lab-head">
        <p className="eyebrow">信道编码实验台</p>
        <h1>用一半的速率，换回几次纠错</h1>
        <div className="short-film-row">
          <p className="lede">
            每 1 个信息比特吐出 2 个码比特，速率砍半；换来的是：接收端即使有些比特被噪声打翻，
            也能顺着编码留下的约束找回去。下面先用一条 12 比特的短序列把四行摊开，再扫一条对照曲线。
          </p>
          <ShortFilm file="conv-viterbi.mp4" seconds={48} />
        </div>
      </header>

      {fromQuery && (
        <FromQuestionNote
          text={`这组参数来自任务模式「你自己出题」：卷积码 · ${ebN0} dB · ${infoBits} 信息比特 · ${noiseOn ? '有噪声' : '无噪声'}。已经原样回填；改动控件后这组参数就归你了。`}
          onRestore={() => {
            setEbN0(2)
            setInfoBits(DEFAULT_INFO_BITS)
            setNoiseOn(true)
            setFromQuery(false)
            history.replaceState(null, '', '#/conv')
          }}
        />
      )}

      <div className="conv-stage">
        <section className="chart-block sequence" aria-label="短序列例子">
          <BitRow
            label="原始比特"
            hint={`${demo.bits.length} 位信息`}
            bits={demo.bits}
            tones={demo.bits.map(() => 'plain')}
          />
          <BitRow
            label="编码后"
            hint={`${demo.coded.length} 位码字（末尾 ${demo.tailBits} 位是补零）`}
            bits={demo.coded}
            tones={demo.coded.map((_, index) =>
              index >= demo.coded.length - demo.tailBits ? 'tail' : 'plain',
            )}
          />
          <BitRow
            label="加噪后"
            hint={`接收端切出来的比特，错了 ${demo.codedErrors} 位`}
            bits={demo.sliced}
            tones={noisyTones}
          />
          <BitRow
            label={decoder === 'hard' ? '硬判决译码' : '软判决译码'}
            hint={
              allOk
                ? `${demo.bits.length} 位信息全对${demo.codedErrors > 0 ? `，把 ${demo.codedErrors} 个错比特纠回来了` : ''}`
                : `还有 ${demo.infoErrors} 位没纠回来`
            }
            bits={demo.decoded}
            tones={decodedTones}
          />

          <p className={`sequence-status ${allOk ? 'ok' : 'bad'}`}>
            {allOk
              ? flipCount > 0
                ? `手动翻了 ${flipCount} 位，译码后原样回来了。`
                : '译码结果与原始比特逐位相同。'
              : `译码结果和原始比特不同：第 ${demo.decoded
                  .map((bit, index) => (bit === demo.bits[index] ? null : index + 1))
                  .filter((value) => value !== null)
                  .join('、')} 位没有纠回来。翻错的位置和数量超出了这个码能分辨的本事。`}
          </p>

          <div className="legend-row">
            <span className="legend-dot error" /> 接收端被打翻的比特
            <span className="legend-dot wrong" /> 译码后仍然错的比特
            <span className="legend-dot tail" /> 补零比特
          </div>

          <details className="conv-guide">
            <summary>四行怎么读</summary>
          <p className="read-guide">
            四行是同一条链路上四个位置的样子：<strong>原始</strong>是你要发的 {infoBits} 位信息；
            <strong>编码后</strong>是真正上路的 {2 * (infoBits + 2)} 位码字（末尾两位淡灰是补零）；
            <strong>加噪后</strong>是接收端按门限切出来的比特，琥珀格是噪声打翻的；
            <strong>译码后</strong>只留 {infoBits} 位信息，红色格表示没纠回来、页面不会替你圆。
            把噪声关掉再点「翻 2 位」，加噪后会出现两个琥珀，译码后照样全对——这就是纠错在干活。
          </p>
          </details>
        </section>

        <aside className="controls conv-side" aria-label="实验参数">
          <label className="control">
            <span className="control-label">
              每信息比特信噪比 Eb/N0
              <strong>{ebN0.toFixed(1)} dB</strong>
            </span>
            <input
              type="range"
              min={0}
              max={TO_DB}
              step={0.5}
              value={ebN0}
              onChange={(event) => setEbN0(Number(event.target.value))}
            />
            <span className="control-hint">
              码率 1/2 的那 3.01 dB 折算已经算进内部，这里填的就是每信息比特的信噪比。
            </span>
          </label>

          <div className="control">
            <span className="control-label">噪声</span>
            <div className="segmented">
              <button type="button" aria-pressed={noiseOn} onClick={() => setNoiseOn(true)}>
                开着
              </button>
              <button type="button" aria-pressed={!noiseOn} onClick={() => setNoiseOn(false)}>
                关掉（纯净信道）
              </button>
            </div>
            <span className="control-hint">
              关掉噪声后，加噪后那一行应该和编码后逐位相同；这时再去翻位，看的就是纯纠错能力。
            </span>
          </div>

          <div className="control">
            <span className="control-label">手动翻位</span>
            <div className="segmented">
              <button type="button" aria-pressed={flipKey === 'none'} onClick={() => setFlipKey('none')}>
                不翻
              </button>
              <button type="button" aria-pressed={flipKey === 'one'} onClick={() => setFlipKey('one')}>
                翻 1 位
              </button>
              <button type="button" aria-pressed={flipKey === 'two'} onClick={() => setFlipKey('two')}>
                翻 2 位（分开）
              </button>
              <button type="button" aria-pressed={flipKey === 'burst'} onClick={() => setFlipKey('burst')}>
                翻一片 4 位
              </button>
            </div>
            <span className="control-hint">
              「翻一片 4 位」是故意超出能力的那一档：这个码纠不回来，页面不会把它写成纠回来了。
            </span>
          </div>

          <div className="control">
            <span className="control-label">译码器</span>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={decoder === 'hard'}
                onClick={() => setDecoder('hard')}
              >
                硬判决
              </button>
              <button
                type="button"
                aria-pressed={decoder === 'soft'}
                onClick={() => setDecoder('soft')}
              >
                软判决
              </button>
            </div>
            <span className="control-hint">
              两套译码器是两份独立代码：一个先切比特再比汉明距离，一个直接拿幅度到 ±1 理想点的平方距离当度量。
            </span>
          </div>

          <label className="control">
            <span className="control-label">
              信息比特数
              <strong>{infoBits} 位</strong>
            </span>
            <input
              type="number"
              min={1}
              max={CONV_MAX_INFO_BITS}
              step={1}
              value={infoBits}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isInteger(next) && next >= 1 && next <= CONV_MAX_INFO_BITS) setInfoBits(next)
              }}
            />
            <span className="control-hint">
              短序列一次只摆 {CONV_MAX_INFO_BITS} 位，所以这里最大 {CONV_MAX_INFO_BITS}；改完四行会按新长度重画。
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
              同一颗种子、同一个信噪比，重跑出来的比特和读数逐位相同。
            </span>
          </div>

          <dl className="params">
            <div>
              <dt>短序列长度</dt>
              <dd>{infoBits} 个信息比特（最多 {CONV_MAX_INFO_BITS} 位，四行能同时摆开）</dd>
            </div>
            <div>
              <dt>码型</dt>
              <dd>约束长度 3、码率 1/2、生成多项式 7 与 5</dd>
            </div>
            <div>
              <dt>自由距离</dt>
              <dd>
                dfree = {freed.distance}（在网格上搜出来的，不是写死的）
              </dd>
            </div>
            <div>
              <dt>纠错能力</dt>
              <dd>
                一个约束窗口内可纠 {correctable} 位硬错误（⌊(dfree−1)/2⌋ = {correctable}）
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="notes" aria-label="这个码怎么读">
        <article className="note-card">
          <h2>约束长度 3 是什么意思</h2>
          <p>
            每个码比特由当前输入和它前面两位一起决定，看的是 3 位宽的窗口，所以寄存器里只有 2 位历史、
            一共 4 个状态。这 3 位怎么组合成 2 个输出，由两个八进制数定：7 = 111 表示三位全参与异或，
            5 = 101 表示首尾参与、中间那位跳过。代码在 <code>src/core/conv.ts:34</code> 的 POLYS，
            网格在 <code>src/core/conv.ts:61</code> 的 buildTrellis 里一次算好。
          </p>
        </article>

        <article className="note-card">
          <h2>码距决定纠错能力</h2>
          <p>
            任意两条码序列之间最少差多少位，叫自由距离 dfree。这个码的 dfree =
            {' '}{freed.distance}，所以一个窗口里错 {correctable} 位还能找回来；再多，就可能落到
            另一条合法路径上——译码器会自信地给出一个错的答案。页面右上那个「纠错能力」就是
            ⌊(dfree−1)/2⌋ 算出来的。dfree 不是背的常数，是
            <code>src/core/conv.ts:216</code> 的 freeDistance() 在网格上搜出来的：换生成多项式，它会跟着变。
          </p>
        </article>

        <article className="note-card">
          <h2>末尾补零为了什么</h2>
          <p>
            编码器的寄存器一开始是 00。发完最后一个信息比特，寄存器里还留着两位历史，
            码字此时停在某个不确定的状态上，译码器回溯时不知道该从哪个状态收尾。
            末尾补 2 个 0，就是让寄存器在这两拍里逐步归零，码字一定结束在状态 00：
            终点确定了，回溯路径唯一。补零不是凑长度，是给码字一个已知的终止条件——
            代价是多传 2 个比特。
          </p>
        </article>

        <article className="note-card">
          <h2>软判决为什么能多挣几个 dB</h2>
          <p>
            硬判决先按 0 这个门限把幅度切成 0/1，于是「收到 0.02」和「收到 0.49」都变成同一个比特 0，
            信息丢在门口。软判决不切：<code>src/core/conv.ts:163</code> 的 decodeSoft 直接算接收幅度到
            ±1 理想点的平方距离（<code>src/core/conv.ts:180</code>），错得越远、代价越高，
            译码器就知道该更相信哪些比特。代价是要把模拟幅度一路送到译码器，工程上比硬判决麻烦。
          </p>
        </article>
      </section>

      <section className="curve-block" aria-label="三条线对照">
        <header className="section-head">
          <h2>0–10 dB 扫一遍：三条线放一起</h2>
          <p>
            11 个 Eb/N0 点，每点 {CURVE_BITS.toLocaleString('en-US')} 个信息比特，同一个种子。
            一条是不编码直接 BPSK，一条是编码后硬判决译码，一条是编码后软判决译码。
            横轴按每信息比特的能量算，编码那两条已经把码率的 3.01 dB 折算进去了，所以是在同一把尺子上比。
          </p>
        </header>
        <p className="conv-curve-cue">
          翻位与判决方式变了，曲线不变，曲线只跟信噪比走。
        </p>
        <ConvCurveChart points={curve} fromDb={FROM_DB} toDb={CURVE_TO_DB} />
        <p className="curve-note">
          看两条编码线的间距：低信噪比处软判决比硬判决低将近一个数量级，高信噪比处两者都掉到样本分辨率以下。
          如果这两条几乎重合，说明软信息根本没进到度量里——那说明译码器写错了，不是物理规律如此。
          另外注意左边：0–2 dB 一带硬判决反而比不编码更差，这不是 bug，是硬判决把软信息丢掉以后
          在噪声大的地方先付了代价。
        </p>
      </section>
    </main>
  )
}
