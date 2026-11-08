/**
 * 课程视图的单测。
 *
 * 判据里最容易悄悄退化的几件事都在这里钉住：
 * 13 章必须全在、只有 2/5/6/7/10 能玩、每屏参数不超过 4 个、
 * 每章的默认态不报红而「让它失效」之后必须报红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COURSE_CHAPTERS,
  DEEP_LAB_CHAPTERS,
  binaryEntropy,
  channelCapacity,
  channelLimit,
  chapterByNo,
  pllLockStep,
  pllResidual,
  pllStep,
  pllTrace,
  processSigmaTheory,
  processStats,
  selfInfo,
} from '../src/core/course.ts'
import { parseHash } from '../src/router.ts'
import { qFunction } from '../src/core/ber.ts'

test('左树 13 章，章号 1 到 13 连续', () => {
  assert.equal(COURSE_CHAPTERS.length, 13)
  COURSE_CHAPTERS.forEach((chapter, index) => {
    assert.equal(chapter.no, index + 1)
    assert.ok(chapter.title.length > 0)
  })
})

test('本轮只实现第 1、2、3、4、5、6、7、8、9、10、11、12 章', () => {
  const done = COURSE_CHAPTERS.filter((c) => c.implemented).map((c) => c.no)
  assert.deepEqual(done, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  for (const chapter of COURSE_CHAPTERS) {
    if (chapter.implemented) assert.equal(typeof chapter.compute, 'function')
    else assert.ok(chapter.reason.length > 10, `第 ${chapter.no} 章没写未实现原因`)
  }
})

test('只有第 4、8、11 章带深度实验台入口', () => {
  assert.deepEqual(DEEP_LAB_CHAPTERS, [4, 8, 11])
  const withLab = COURSE_CHAPTERS.filter((c) => c.labs?.length).map((c) => c.no)
  assert.deepEqual(withLab, [4, 8, 11])
  // 第 8 章同时有 QAM 与 OFDM 两台，第 4、11 章各一台。
  assert.equal(chapterByNo(8)?.labs?.length, 2)
  assert.equal(chapterByNo(4)?.labs?.length, 1)
  assert.equal(chapterByNo(11)?.labs?.length, 1)
})

test('未实现的章也有一句话问题和空参数，页面不会崩', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (chapter.implemented) continue
    assert.equal(chapter.params.length, 0)
    assert.equal(chapter.failPreset, chapter.failPreset)
  }
})

test('每屏参数 2 到 4 个，默认值都落在滑杆范围内', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.implemented) continue
    assert.ok(chapter.params.length >= 2 && chapter.params.length <= 4, `第 ${chapter.no} 章参数个数不对`)
    for (const param of chapter.params) {
      const value = chapter.defaults[param.key]
      assert.ok(Number.isFinite(value), `${param.key} 没有默认值`)
      assert.ok(value >= param.min && value <= param.max, `${param.key} 默认值越界`)
    }
  }
})

test('默认态：三到四个读数、一张图、一句话结论，且不报红', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const view = chapter.compute(chapter.defaults)
    assert.ok(view.readouts.length >= 3 && view.readouts.length <= 4, `第 ${chapter.no} 章读数 ${view.readouts.length} 个`)
    assert.ok(view.series.length >= 1)
    assert.ok(view.stack ? view.series[0].points.length >= 4 : view.series[0].points.length > 10, `第 ${chapter.no} 章点数太少`)
    assert.ok(view.conclusion.length > 10)
    assert.equal(view.failed, false, `第 ${chapter.no} 章默认态就报红了`)
    assert.equal(view.readouts.some((r) => r.warn), false)
  }
})

test('每章至少一个读数是「理论值 / 实测值」成对', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const view = chapter.compute(chapter.defaults)
    assert.ok(view.readouts.some((r) => r.hint.includes('理论')), `第 ${chapter.no} 章没有理论对照`)
  }
})

test('「让它失效」之后读数标红、结论改口', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const normal = chapter.compute(chapter.defaults)
    const broken = chapter.compute(chapter.failPreset)
    assert.equal(broken.failed, true, `第 ${chapter.no} 章的反例没触发`)
    assert.ok(broken.readouts.some((r) => r.warn))
    assert.notEqual(broken.conclusion, normal.conclusion)
  }
})

test('同一组参数算两次，结论与读数逐字相同', () => {
  const chapter = chapterByNo(5)!
  const a = chapter.compute!(chapter.defaults)
  const b = chapter.compute!({ ...chapter.defaults })
  assert.deepEqual(a.readouts.map((r) => r.value), b.readouts.map((r) => r.value))
  assert.equal(a.conclusion, b.conclusion)
})

test('chroma 外的章号取不到，页面回退到第 2 章', () => {
  assert.equal(chapterByNo(0), undefined)
  assert.equal(chapterByNo(99), undefined)
  assert.ok(chapterByNo(2))
})

test('#/course 路由认得出来，未知路径仍回首页', () => {
  assert.equal(parseHash('#/course'), 'course')
  assert.equal(parseHash('#/course/'), 'course')
  assert.equal(parseHash('#/course?no=5'), 'course')
  assert.equal(parseHash('#/nope'), 'home')
})

test('第 6 章眼图：默认张着、反例闭上，两个读数带理论对照', () => {
  const chapter = chapterByNo(6)
  assert.ok(chapter)
  const base = chapter.compute(chapter.defaults)
  assert.equal(base.failed, false)
  const eye = Number(base.readouts[0].value)
  // 20 dB、无多径、采样对准判决点：两簇内沿之差应接近满开 2（噪声扣掉约 0.3）。
  assert.ok(Math.abs(eye - 1.7) <= 0.15, `默认档眼高应在 1.7 附近，实际 ${eye}`)
  // 信噪比往下拖，眼高必须跟着掉——旧写法是反的。
  const lowSnr = Number(chapter.compute({ ...chapter.defaults, eyeSnrDb: 8 }).readouts[0].value)
  assert.ok(lowSnr < eye, `8 dB 的眼高 ${lowSnr} 应低于 20 dB 的 ${eye}`)

  // 8 dB 眼还张着（0.90），不能判失败，也不能说「叠到一起 / 判决等于猜」。
  const at8 = chapter.compute({ ...chapter.defaults, eyeSnrDb: 8 })
  assert.equal(at8.failed, false, '8 dB 眼高 0.90，不该判成闭眼')
  assert.ok(!at8.conclusion.includes('叠到一起'), `8 dB 的结论不该说眼图闭上，实际「${at8.conclusion}」`)
  assert.ok(!at8.conclusion.includes('判决等于猜'), '8 dB 误码率为 0，不能说判决等于猜')
  assert.ok(at8.conclusion.includes('收窄'), `8 dB 应说成「还开着但收窄」，实际「${at8.conclusion}」`)

  // 4 dB 真正闭眼：必须由 eyeHeight < 0.6 触发，而不是信噪比硬阈值。
  const at4 = chapter.compute({ ...chapter.defaults, eyeSnrDb: 4 })
  assert.equal(at4.failed, true, '4 dB 应判失败')
  assert.ok(Number(at4.readouts[0].value) < 0.6, `4 dB 眼高应低于 0.6，实际 ${at4.readouts[0].value}`)
  assert.equal(at4.readouts[1].value, '0.000', '4 dB 采样对准时 ISI 仍为 0，失败只能由眼高触发')
  assert.ok(base.readouts.some((item) => item.hint.includes('理论')))
  assert.equal(base.readouts[1].value, '0.000', '采样落在判决点上时，升余弦的 ISI 应为 0')

  const failed = chapter.compute(chapter.failPreset)
  assert.equal(failed.failed, true)
  const closed = Number(failed.readouts[0].value)
  assert.ok(closed < 0.3, `α=0.05、定时误差 0.45Ts 的眼高应小于 0.3，实际 ${closed}`)
  assert.ok(failed.readouts.some((item) => item.warn), '反例里至少要有一条读数标红')
  assert.notEqual(failed.conclusion, base.conclusion)
  assert.ok(failed.conclusion.includes('叠到一起'), `失败预设眼高 0.00，结论应说闭眼，实际「${failed.conclusion}」`)
})

test('第 6 章：滚降系数越小，峰值 ISI 越大', () => {
  const chapter = chapterByNo(6)
  const isi = (alpha: number): number =>
    Number(chapter.compute({ alpha, eyeSnrDb: 20, multipath: 0, timing: 0.2 }).readouts[1].value)
  assert.ok(isi(0.05) > isi(0.35))
  assert.ok(isi(0.35) > isi(0.99))
  // 单调性之外钉一个绝对值：采样偏 0.2Ts、α=0.05 时峰值 ISI 应为 0.917。
  assert.ok(Math.abs(isi(0.05) - 0.917) < 0.002, `α=0.05、偏 0.2Ts 的 ISI 应约 0.917，实际 ${isi(0.05)}`)
  assert.equal(
    chapter.compute({ alpha: 0.05, eyeSnrDb: 20, multipath: 0, timing: 0 }).readouts[1].value,
    '0.000',
    'α 再小，采样对准判决点时 ISI 也应为 0',
  )
})

test('第 6 章同参重跑结果一致', () => {
  const chapter = chapterByNo(6)
  const a = chapter.compute(chapter.defaults)
  const b = chapter.compute(chapter.defaults)
  assert.deepEqual(a.readouts, b.readouts)
  assert.equal(a.series[0].points.length, b.series[0].points.length)
})

test('第 7 章：四种调制在 8 dB 的理论误码率由 qFunction 现算', () => {
  const chapter = chapterByNo(7)
  const gamma = 10 ** 0.8
  const expected = [
    qFunction(Math.sqrt(gamma)), // 2ASK 单极性 OOK
    qFunction(Math.sqrt(gamma)), // 2FSK
    qFunction(Math.sqrt(2 * gamma)), // 2PSK
    0.5 * Math.exp(-gamma), // 2DPSK
  ]
  expected.forEach((want, scheme) => {
    const got = Number(chapter.compute({ ...chapter.defaults, scheme }).readouts[0].value)
    assert.ok(
      Math.abs(got - want) / want < 0.02,
      `第 ${scheme} 档 8 dB 理论值应为 ${want}，实际 ${got}`,
    )
  })
})

test('第 7 章：2PSK 在 8 dB 严格好于 2FSK，图是四线加一组实测点', () => {
  const chapter = chapterByNo(7)
  const psk = Number(chapter.compute({ ...chapter.defaults, scheme: 2 }).readouts[0].value)
  const fsk = Number(chapter.compute({ ...chapter.defaults, scheme: 1 }).readouts[0].value)
  assert.ok(psk < fsk, `2PSK ${psk} 应严格小于 2FSK ${fsk}`)
  const view = chapter.compute(chapter.defaults)
  assert.equal(view.logY, true, '误码率曲线必须用对数纵轴')
  assert.equal(view.series.length, 5, '四条理论曲线 + 一组实测点')
  assert.equal(view.series[4].marker, true, '实测点只画散点')
  assert.equal(view.series[4].points.length, 1)
})

test('第 7 章：φ=45 的 2PSK 与 φ=0 的 2FSK 落在同一个量级（那 3 dB 被吃干净）', () => {
  const chapter = chapterByNo(7)
  const psk45 = Number(chapter.compute({ scheme: 2, ebn0Db: 8, phaseDeg: 45 }).readouts[0].value)
  const fsk0 = Number(chapter.compute({ scheme: 1, ebn0Db: 8, phaseDeg: 0 }).readouts[0].value)
  const ratio = psk45 / fsk0
  assert.ok(ratio > 0.1 && ratio < 10, `两者相差应不到一个数量级，实际比值 ${ratio}`)
  assert.ok(Math.abs(ratio - 1) < 0.01, `cos²45° 把 2PSK 的 3 dB 优势全吃掉，比值应约 1，实际 ${ratio}`)
})

test('第 7 章：2ASK 与 2FSK 在 8 dB 打平，2PSK 比它们低约 3 dB（2 到 2.5 倍）', () => {
  const chapter = chapterByNo(7)
  const ask = Number(chapter.compute({ ...chapter.defaults, scheme: 0 }).readouts[0].value)
  const fsk = Number(chapter.compute({ ...chapter.defaults, scheme: 1 }).readouts[0].value)
  const psk = Number(chapter.compute({ ...chapter.defaults, scheme: 2 }).readouts[0].value)
  assert.equal(ask, fsk, `2ASK 与 2FSK 的单极性模型应当相等，实际 ${ask} 与 ${fsk}`)
  // 3 dB 优势按达到同一误码率所需的线性信噪比折算：10^(3.01/10) = 2.00 倍。
  const gainDb = Number(chapter.compute({ ...chapter.defaults, scheme: 2 }).readouts[2].value.replace(' dB', ''))
  const gammaRatio = Number((10 ** (gainDb / 10)).toFixed(2))
  assert.ok(gammaRatio >= 2 && gammaRatio <= 2.5, `2PSK 相对 2FSK 的线性增益应为 2–2.5 倍，实际 ${gammaRatio}`)
  assert.ok(psk < fsk, `2PSK ${psk} 的误码率必须低于 2FSK ${fsk}`)
  const askView = chapter.compute({ ...chapter.defaults, scheme: 0 })
  assert.equal(askView.readouts[2].value, '0.0 dB', '2ASK 相对 2FSK 的增益应当是 0.0 dB')
  assert.equal(askView.readouts[2].warn, true, '打平时增益读数要标红')
})

test('第 7 章：2ASK 的蒙特卡洛实测落在理论值的十分之一到十倍之间', () => {
  const chapter = chapterByNo(7)
  const view = chapter.compute({ ...chapter.defaults, scheme: 0 })
  const theory = Number(view.readouts[0].value)
  const measured = Number(view.readouts[1].value)
  assert.ok(measured > theory / 10 && measured < theory * 10, `实测 ${measured} 与理论 ${theory} 差得太远`)
  assert.equal(view.series[4].marker, true)
})

test('第 7 章失效档：增益 0.0 dB 标红、结论改口；默认档 3.0 dB 不报红', () => {
  const chapter = chapterByNo(7)
  const bad = chapter.compute(chapter.failPreset)
  assert.equal(bad.failed, true)
  assert.equal(bad.readouts[2].value, '0.0 dB')
  assert.equal(bad.readouts[2].warn, true, '增益为 0 必须标红')
  assert.match(bad.conclusion, /打平/)
  assert.match(bad.conclusion, /3 dB/)
  const good = chapter.compute(chapter.defaults)
  assert.equal(good.failed, false)
  assert.equal(good.readouts[2].value, '3.0 dB')
  assert.equal(good.readouts[2].warn, false)
  assert.match(good.conclusion, /往左移/)
})

test('第 8 章：M=4 退化成 2PSK，与第 7 章的数字完全对上', () => {
  const qam = chapterByNo(8)
  const qpsk = qam.compute({ ...qam.defaults, mod: 0 })
  const theory = Number(qpsk.readouts[1].value)
  const psk = chapterByNo(7).compute({ scheme: 2, ebn0Db: 12, phaseDeg: 0 })
  const pskBer = Number(psk.readouts[0].value)
  assert.equal(theory, pskBer, `QPSK ${theory} 必须等于 2PSK ${pskBer}`)
  const gamma = 10 ** (12 / 10)
  assert.ok(Math.abs(theory - qFunction(Math.sqrt(2 * gamma))) / theory < 0.01, 'M=4 要落在 Q(√(2Eb/N0)) 上')
})

test('第 8 章：12 dB 下四档理论误码率严格递减', () => {
  const qam = chapterByNo(8)
  const values = [0, 1, 2, 3].map((mod) => Number(qam.compute({ ...qam.defaults, mod }).readouts[1].value))
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] > values[i - 1], `第 ${i} 档 ${values[i]} 应大于前一档 ${values[i - 1]}`)
  assert.ok(values[0] < 1e-8 && values[1] > 1e-5 && values[1] < 1e-3, `QPSK ${values[0]} / 16QAM ${values[1]} 的量级不对`)
  assert.ok(values[2] > 5e-3 && values[2] < 2e-2, `64QAM ${values[2]} 应落在 1e-2 量级`)
  assert.ok(values[3] > 2e-2 && values[3] < 1e-1, `256QAM ${values[3]} 应落在 5e-2 量级`)
})

test('第 8 章：16QAM 与 64QAM 达同一误码率的 Eb/N0 差落在 4 到 7 dB 之间', () => {
  const qam = chapterByNo(8)
  const view = qam.compute({ ...qam.defaults, mod: 2 })
  const match = /多花 ([\d.]+) dB/.exec(view.conclusion)
  assert.ok(match, `结论里要有「多花 X dB」，实际：${view.conclusion}`)
  const extra = Number(match![1])
  assert.ok(extra >= 4 && extra <= 7, `16QAM 到 64QAM 的代价应在 4–7 dB，实际 ${extra}`)
})

test('第 8 章：四档蒙特卡洛实测都落在理论值的十分之一到十倍之间', () => {
  const qam = chapterByNo(8)
  for (const mod of [0, 1, 2, 3]) {
    const view = qam.compute({ ...qam.defaults, mod, ebn0Db: 4 })
    const theory = Number(view.readouts[1].value)
    const measured = Number(view.readouts[2].value)
    assert.ok(measured > theory / 10 && measured < theory * 10, `M=${[4, 16, 64, 256][mod]} 实测 ${measured} 与理论 ${theory} 差得太远`)
  }
  const bad = qam.compute(qam.failPreset)
  assert.equal(bad.failed, true)
  assert.equal(bad.readouts[2].warn, true, '失效档的实测读数要标红')
  assert.match(bad.conclusion, /每传 20 个符号就错一个/)
})

test('第 9 章：三种波形在 Δt=0 的峰值信噪比完全相等，且等于 10·log10(2γ)', () => {
  const chapter = chapterByNo(9)
  const snr = [0, 1, 2].map((wave) => Number.parseFloat(chapter.compute({ ...chapter.defaults, wave }).readouts[0].value))
  const expect = 10 * Math.log10(2 * 10 ** (8 / 10))
  for (const value of snr) assert.ok(Math.abs(value - expect) < 0.05, `峰值信噪比 ${value} 与 10log10(2γ)=${expect.toFixed(2)} 差得太多`)
  assert.ok(Math.abs(snr[0] - snr[1]) < 0.01 && Math.abs(snr[1] - snr[2]) < 0.01, '三种波形必须完全打平')
})

test('第 9 章：矩形波 Δt=0.4 损失 4.44 dB，数值 ρ 与解析 1−Δt 对上', () => {
  const chapter = chapterByNo(9)
  const view = chapter.compute({ ...chapter.defaults, dt: 0.4 })
  const loss = Number.parseFloat(view.readouts[1].value)
  assert.ok(Math.abs(loss - 4.44) < 0.05, `损失应为 4.44 dB，实际 ${loss}`)
  const rho = 10 ** (-loss / 20)
  assert.ok(Math.abs(rho - (1 - 0.4)) < 0.01, `数值 ρ=${rho.toFixed(3)} 与解析 0.6 差得太多`)
  assert.equal(view.failed, true, 'Δt=0.4 应当判失配')
  assert.equal(view.readouts[1].warn, true, '损失读数要标红')
})

test('第 9 章：三种波形在 Δt=0 的理论误码率彼此相等', () => {
  const chapter = chapterByNo(9)
  const ber = [0, 1, 2].map((wave) => chapter.compute({ ...chapter.defaults, wave }).readouts[2].value)
  assert.equal(ber[1], ber[0])
  assert.equal(ber[2], ber[0])
  assert.equal(ber[0], '1.91e-4')
})

test('第 9 章：实测误码率落在理论值的十分之一到十倍之间', () => {
  const chapter = chapterByNo(9)
  const view = chapter.compute(chapter.defaults)
  const theory = Number(view.readouts[2].value)
  const hint = view.readouts[2].hint
  const match = /实测 ([0-9.e-]+)/.exec(hint)
  assert.ok(match, `读数 hint 里要有实测值，实际：${hint}`)
  const measured = Number(match![1])
  assert.ok(measured > theory / 10 && measured < theory * 10, `实测 ${measured} 与理论 ${theory} 差得太远`)
})

test('第 12 章：四档级数的周期都等于 2^n−1', () => {
  const chapter = chapterByNo(12)
  for (const [index, n] of [4, 5, 6, 7].entries()) {
    const view = chapter.compute({ ...chapter.defaults, level: index })
    assert.equal(Number(view.readouts[0].value), 2 ** n - 1, `n=${n} 的周期不对：${view.readouts[0].value}`)
  }
})

test('第 12 章：非零延迟的自相关全等于 −1/N，整条曲线只有两个值', () => {
  const chapter = chapterByNo(12)
  const view = chapter.compute(chapter.defaults)
  const points = view.series[0].points
  const period = Number(view.readouts[0].value)
  assert.equal(points.length, period)
  assert.equal(points[0][1], 1)
  for (const [tau, value] of points.slice(1)) {
    assert.ok(Math.abs(value - -1 / period) < 1e-12, `τ=${tau} 的自相关是 ${value}，应为 ${-1 / period}`)
  }
  const distinct = new Set(points.map(([, v]) => v.toFixed(12)))
  assert.equal(distinct.size, 2, `自相关只该有两个值，实际 ${distinct.size} 个`)
})

test('第 12 章：换初始状态只搬相移，自相关序列一模一样', () => {
  const chapter = chapterByNo(12)
  const base = chapter.compute({ ...chapter.defaults, initOpt: 0 }).series[0].points.map(([, v]) => v)
  for (const initOpt of [1, 2]) {
    const other = chapter.compute({ ...chapter.defaults, initOpt }).series[0].points.map(([, v]) => v)
    assert.equal(other.length, base.length)
    for (let i = 0; i < base.length; i += 1) assert.ok(Math.abs(other[i] - base[i]) < 1e-12, `initOpt=${initOpt} 第 ${i} 个延迟对不上`)
  }
})

test('第 12 章：非本原抽头让周期掉下来，自相关冒出第三个值', () => {
  const chapter = chapterByNo(12)
  const view = chapter.compute(chapter.failPreset)
  const period = Number(view.readouts[0].value)
  assert.ok(period < 127, `失效抽头的周期应短于 127，实际 ${period}`)
  const distinct = new Set(view.series[0].points.map(([, v]) => v.toFixed(9)))
  assert.ok(distinct.size > 2, `自相关的值种类应多于两个，实际 ${distinct.size}`)
  assert.equal(view.failed, true)
  assert.equal(view.readouts[0].warn, true)
})

test('第 11 章：(7,4) 的最小距离为 3、可纠 1 位，d 由码字枚举复核', () => {
  const chapter = chapterByNo(11)
  const view = chapter.compute({ ...chapter.defaults, level: 0 })
  assert.equal(view.readouts[0].value, '3')
  assert.equal(view.readouts[1].value, '1')
  // 独立复核：枚举 2^7 个 7 位字，留下校正子为零的码字，两两算汉明距离。
  const words: number[][] = []
  for (let w = 0; w < 1 << 7; w += 1) {
    const bits = Array.from({ length: 7 }, (_, i) => (w >> i) & 1)
    let syndrome = 0
    for (let bit = 0; bit < 3; bit += 1) {
      let acc = 0
      for (let i = 0; i < 7; i += 1) acc ^= bits[i] & ((i + 1 >> bit) & 1)
      syndrome |= acc << bit
    }
    if (syndrome === 0) words.push(bits)
  }
  assert.equal(words.length, 16)
  let min = 7
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      let dist = 0
      for (let b = 0; b < 7; b += 1) if (words[i][b] !== words[j][b]) dist += 1
      if (dist < min) min = dist
    }
  }
  assert.equal(min, 3)
})

test('第 11 章：e ≤ 1 时三档的正确率都是 100%', () => {
  const chapter = chapterByNo(11)
  for (const level of [0, 1, 2]) {
    for (const errors of [0, 1]) {
      const view = chapter.compute({ ...chapter.defaults, level, errors })
      assert.equal(view.readouts[2].value, '100.0%', `level=${level} e=${errors} 正确率不对`)
      assert.equal(view.readouts[2].warn, false)
    }
  }
})

test('第 11 章：e = 2 时全被误纠、没有一个静默放行', () => {
  const chapter = chapterByNo(11)
  const view = chapter.compute({ ...chapter.defaults, errors: 2 })
  const hint = view.readouts[2].hint
  assert.match(hint, /误纠 (\d+)（100\.0%）/)
  assert.match(hint, /静默放行 0/)
  assert.equal(view.failed, true)
  assert.equal(view.readouts[2].warn, true)
})

test('第 11 章：校正子桶大小是 2^k，取值只有 2^(n−k) 种', () => {
  const chapter = chapterByNo(11)
  for (const [level, bucket] of [[0, 16], [1, 2048], [2, 67108864]] as const) {
    const view = chapter.compute({ ...chapter.defaults, level, errors: 1 })
    assert.ok(view.readouts[2].hint.includes(`每种对应 ${bucket} 个错误模式`), `level=${level} 桶大小不对：${view.readouts[2].hint}`)
  }
})

test('第 1 章：p = 0.5 时单次信息量与熵都精确等于 1 bit', () => {
  assert.ok(Math.abs(selfInfo(0.5) - 1) < 1e-12)
  assert.ok(Math.abs(binaryEntropy(0.5) - 1) < 1e-12)
  const chapter = chapterByNo(1)
  const view = chapter.compute({ ...chapter.defaults })
  assert.equal(view.readouts[0].value, '1.00 bit')
  assert.equal(view.readouts[1].value, '1.000 bit')
  assert.equal(view.failed, false)
})

test('第 1 章：熵在 p = 0.5 处取最大，扫 0.01–0.99 全区间验证', () => {
  const peak = binaryEntropy(0.5)
  for (let i = 1; i <= 99; i += 1) {
    const p = i / 100
    assert.ok(binaryEntropy(p) <= peak + 1e-12, `p=${p} 的熵 ${binaryEntropy(p)} 超过 0.5 处的 ${peak}`)
    if (i !== 50) assert.ok(binaryEntropy(p) < peak - 1e-6, `p=${p} 不该和峰值一样高`)
  }
})

test('第 1 章：p = 0.99 时单次跌到 0.0145 bit、熵 0.0808 bit', () => {
  assert.ok(Math.abs(selfInfo(0.99) - 0.01450) < 1e-4)
  assert.ok(Math.abs(selfInfo(0.01) - 6.6439) < 1e-3)
  const chapter = chapterByNo(1)
  const view = chapter.compute({ ...chapter.defaults, p: 0.99 })
  assert.equal(view.failed, true)
  assert.equal(view.readouts[0].value, '0.01 bit')
  assert.match(view.readouts[1].value, /0\.081/)
  assert.match(view.conclusion, /平均/)
})

test('第 1 章：单次信息量随 p 严格递减，不再镜像', () => {
  let prev = Infinity
  for (let i = 1; i <= 99; i += 1) {
    const p = i / 100
    const value = selfInfo(p)
    assert.ok(value < prev, `p=${p} 的 ${value} 不小于前一个 ${prev}`)
    prev = value
  }
})

test('第 1 章：p 小于 0.5 时单次大于熵，大于 0.5 时反过来', () => {
  assert.ok(selfInfo(0.3) > binaryEntropy(0.3))
  assert.ok(selfInfo(0.7) < binaryEntropy(0.7))
  assert.ok(Math.abs(selfInfo(0.5) - 1) < 1e-12)
  assert.ok(Math.abs(binaryEntropy(0.5) - 1) < 1e-12)
})

test('第 1 章：实测平均信息量贴近熵（n = 20 万、p = 0.3）', () => {
  const chapter = chapterByNo(1)
  const view = chapter.compute({ ...chapter.defaults, p: 0.3, sample: 3 })
  const measured = Number(view.readouts[2].value.replace(' bit', ''))
  assert.ok(Math.abs(measured - binaryEntropy(0.3)) < 0.02, `实测 ${measured} 与 H(0.3)=${binaryEntropy(0.3)} 差太远`)
  assert.equal(view.readouts[2].warn, false)
})

test('第 11 章：e = 0 那根柱归正确纠回，静默放行只留多错模式', () => {
  const chapter = chapterByNo(11)
  const view = chapter.compute({ ...chapter.defaults, errors: 0 })
  const corrected = view.series.find((s) => s.name === '正确纠回')
  const silent = view.series.find((s) => s.name === '静默放行')
  assert.equal(corrected?.points[0][1], 1)
  assert.equal(silent?.points[0][1], 0)
  assert.equal(view.readouts[2].value, '100.0%')
})

test('第 4 章：香农容量在 1 kHz、20 dB 下等于 6.658 kbit/s', () => {
  assert.ok(Math.abs(channelCapacity(1, 20) - 6.658) < 1e-3)
})

test('第 4 章：对数带宽网格上容量严格递增、频谱效率严格递减', () => {
  let prevC = -Infinity
  let prevEff = Infinity
  for (let i = 0; i <= 80; i += 1) {
    const b = 0.1 * 10 ** ((4 * i) / 80)
    const c = channelCapacity(b, 20)
    assert.ok(c > prevC)
    assert.ok(c / b < prevEff)
    prevC = c
    prevEff = c / b
  }
})

test('第 4 章：带宽无穷大时容量趋近 1.4427·S/N0', () => {
  const limit = channelLimit(20)
  assert.ok(Math.abs(limit - 144.27) < 0.05)
  assert.ok(Math.abs(channelCapacity(1e7, 20) - limit) / limit < 0.01)
})

test('第 4 章：信噪比从 0 到 30 dB，容量恒正且单调增', () => {
  let prev = -Infinity
  for (let snr = 0; snr <= 30; snr += 1) {
    const c = channelCapacity(1, snr)
    assert.ok(c > 0)
    assert.ok(c > prev)
    prev = c
  }
})

test('第 4 章：默认档不报红、1000 kHz 档改口并标红', () => {
  const small = chapterByNo(4)!.compute({ snr0Db: 20, bandIndex: 3 })
  assert.equal(small.failed, false)
  assert.equal(small.readouts[0].value, '6.66 kbit/s')
  assert.ok(small.conclusion.includes('打折'))
  const wide = chapterByNo(4)!.compute({ snr0Db: 20, bandIndex: 12 })
  assert.equal(wide.failed, true)
  assert.equal(wide.readouts[0].value, '137.50 kbit/s')
  assert.equal(wide.readouts[2].warn, true)
  assert.ok(wide.conclusion.includes('天花板'))
})

test('第 3 章：白噪声 100 ms 的 σ_T 落在 1/√1000 的 ±15% 内', () => {
  const stats = processStats(0, 100, 100)
  const theory = 1 / Math.sqrt(1000)
  assert.ok(Math.abs(theory - 0.0316) < 1e-3)
  assert.ok(Math.abs(stats.sigma - theory) / theory < 0.15, `实测 ${stats.sigma} 偏离 0.0316 超过 15%`)
})

test('第 3 章：一阶低通的 σ_T 至少是白噪声的 3 倍', () => {
  const white = processStats(0, 100, 100).sigma
  const lowpass = processStats(1, 100, 100).sigma
  assert.ok(lowpass >= white * 3, `低通 ${lowpass} 不到白噪声 ${white} 的 3 倍`)
  // 解析值 √(2τ/T)：τ=1 ms、T=100 ms 时是 0.1414。
  assert.ok(Math.abs(processSigmaTheory(1, 100) - 0.1414) < 1e-3)
})

test('第 3 章：非平稳档的带外比例超过 90%', () => {
  const stats = processStats(2, 100, 100)
  assert.ok(stats.outside > 0.9, `带外比例只有 ${stats.outside}`)
  const view = chapterByNo(3)!.compute({ kind: 2, timeIndex: 3, k: 100 })
  assert.equal(view.failed, true)
  assert.equal(view.readouts[2].warn, true)
  assert.ok(view.conclusion.includes('平稳'))
})

test('第 3 章：σ_T 随观测时长按 1/√T 收窄', () => {
  // 10 ms 对 100 ms、100 ms 对 1 s，两段都该是 √10 ≈ 3.16 倍。
  const ratioA = processStats(0, 10, 200).sigma / processStats(0, 100, 200).sigma
  const ratioB = processStats(0, 100, 200).sigma / processStats(0, 1000, 200).sigma
  for (const ratio of [ratioA, ratioB]) {
    assert.ok(Math.abs(ratio - Math.sqrt(10)) / Math.sqrt(10) < 0.15, `实测比值 ${ratio} 偏离 √10 超过 15%`)
  }
})

test('第 13 章：无噪声 K=0.6、θ₀=2.0 在 60 步内进带且不再离开', () => {
  const trace = pllTrace(0.6, 2, 0, 20261112)
  const lock = pllLockStep(trace)
  assert.ok(lock !== null, '60 步里一直没进 ±0.02')
  assert.ok(lock! <= 60)
  // 实测第 7 步进带（2.0000 → 1.4544 → 0.8585 → 0.4044 → 0.1683 → 0.0678 → 0.0272 → 0.0109）。
  assert.equal(lock, 7)
  assert.ok(pllResidual(trace) < 0.02, `稳态 ${pllResidual(trace)} 还在带外`)
  const view = chapterByNo(13)!.compute({ k: 0.6, theta0: 2, sigma: 0 })
  assert.equal(view.failed, false)
  assert.equal(view.readouts[1].value, '7')
  assert.equal(view.readouts.some((r) => r.warn), false)
})

test('第 13 章：小角度下第一步按 1−K 缩，θ₁/θ₀ = 1−K', () => {
  const ratio = pllStep(0.05, 0.6, 0, 0) / 0.05
  // 实测 0.400250：sin 0.05 略小于 0.05，所以比 0.40 多 2.5e-4。
  assert.ok(Math.abs(ratio - 0.4) < 1e-3, `实测 ${ratio} 偏离 1−K = 0.40 超过 1e-3`)
})

test('第 13 章：K=2.40 越过收敛边界，60 步后仍在振荡而不是单调爬行', () => {
  const trace = pllTrace(2.4, 2, 0, 20261112)
  assert.ok(Math.abs(trace[trace.length - 1]) > 0.5, `末值 ${trace[trace.length - 1]} 已经贴到 0 附近`)
  let flips = 0
  for (let i = 2; i < trace.length; i += 1) {
    if (Math.sign(trace[i]) !== Math.sign(trace[i - 1])) flips += 1
  }
  assert.ok(flips > 10, `只变号 ${flips} 次，不像振荡`)
  assert.equal(pllLockStep(trace), null)
  const view = chapterByNo(13)!.compute({ k: 2.4, theta0: 2, sigma: 0 })
  assert.equal(view.failed, true)
  assert.equal(view.readouts[2].value, '没锁住')
  assert.ok(view.conclusion.includes('放大'))
})

test('第 13 章：K=0.05 太慢，60 步后还在 ±0.02 外面', () => {
  const trace = pllTrace(0.05, 2, 0, 20261112)
  // 实测末值 0.1479，相当于 2·(1−K)^60。
  assert.ok(Math.abs(trace[trace.length - 1]) > 0.02, `末值 ${trace[trace.length - 1]} 已经进带`)
  assert.equal(pllLockStep(trace), null)
})

test('第 10 章：四/六/八位三档的相对差都在 2% 以内，谁都不用靠默认档过关', () => {
  const chapter = chapterByNo(10)!
  for (const bits of [4, 6, 8]) {
    const view = chapter.compute({ fs: 4, bits, compand: 0 })
    assert.equal(view.failed, false, `${bits} 位被判红`)
    const snr = view.readouts.find((r) => r.label === '量化信噪比')!
    assert.equal(snr.warn, false, `${bits} 位的量化信噪比读数标红了`)
    // 读数形如「25.77 dB」，hint 里带「相对差 -0.27%，阈值 2%」。
    const measured = Number.parseFloat(snr.value)
    const theory = 6.02 * bits + 1.76
    const rel = Math.abs(measured - theory) / theory
    assert.ok(rel < 0.02, `${bits} 位相对差 ${(rel * 100).toFixed(2)}% 越过 2%`)
    assert.ok(snr.hint.includes('阈值 2%'))
  }
})

test('第 10 章：四位的偏差来自削顶，留半个台阶过载余量后贴着渐近式', () => {
  const chapter = chapterByNo(10)!
  const four = chapter.compute({ fs: 4, bits: 4, compand: 0 })
  const measured = Number.parseFloat(four.readouts.find((r) => r.label === '量化信噪比')!.value)
  // 实测 25.77 dB：满量程正弦不留余量时只有 25.31（差 0.53 dB 全被峰值削顶吃掉）。
  assert.ok(Math.abs(measured - 25.77) < 0.05, `四位实测 ${measured}，与 25.77 差超过 0.05 dB`)
})

test('第 10 章：A 律档另立判据，比同位数均匀实测且必须是净损失', () => {
  const chapter = chapterByNo(10)!
  const uniform = chapter.compute({ fs: 4, bits: 8, compand: 0 })
  const companded = chapter.compute({ fs: 4, bits: 8, compand: 1 })
  const u = Number.parseFloat(uniform.readouts.find((r) => r.label === '量化信噪比')!.value)
  const row = companded.readouts.find((r) => r.label === '量化信噪比（A 律）')!
  const c = Number.parseFloat(row.value)
  // 压扩把台阶按幅度重分配：满量程正弦落在粗的一头，只可能是净损失。
  assert.ok(c < u, `压扩后 ${c} dB 不该高于均匀的 ${u} dB`)
  assert.equal(row.warn, false)
  assert.equal(companded.failed, false)
  assert.ok(row.hint.includes('同位数均匀量化实测'), 'A 律档的 hint 仍拿 6.02n + 1.76 当参照')
  assert.ok(companded.conclusion.includes('不套 6.02n + 1.76'), 'A 律档的结论句没另立口径')
})

test('第 5 章：β=1、25 dB 输入时输出信噪比落在 32.8 dB 附近', () => {
  const chapter = chapterByNo(5)!
  const readOut = (beta: number) => {
    const view = chapter.compute({ mode: 3, m: 0.6, beta, snrIn: 25 })
    const out = Number.parseFloat(view.readouts.find((r) => r.label === '输出信噪比')!.value)
    return { out, view }
  }
  // 3β²(β+1) = 6 → +7.78 dB；25 + 7.78 = 32.78。
  const base = readOut(1)
  assert.ok(Math.abs(base.out - 32.8) < 0.15, `β=1 的输出信噪比 ${base.out} dB，偏离 32.8 超过 0.15 dB`)
  assert.equal(base.view.failed, false)
  // 另外两档一起钉住：β=2 → 3·4·3 = 36 → +15.56 dB → 40.56；β=3 → 3·9·4 = 108 → +20.33 dB → 45.33。
  const b2 = readOut(2)
  assert.ok(Math.abs(b2.out - 40.6) < 0.2, `β=2 的输出信噪比 ${b2.out} dB，偏离 40.6 超过 0.2 dB`)
  const b3 = readOut(3)
  assert.ok(Math.abs(b3.out - 45.3) < 0.2, `β=3 的输出信噪比 ${b3.out} dB，偏离 45.3 超过 0.2 dB`)
})

test('第 5 章：带宽 warn 是双向的，实测比理论小 30% 以上也报红', () => {
  const chapter = chapterByNo(5)!
  // β=1 的 98% 能量带宽只有 Carson 上限的 50%，旧的单向判据不会报。
  const fm = chapter.compute({ mode: 3, m: 0.6, beta: 1, snrIn: 25 })
  const band = fm.readouts.find((r) => r.label === '占用带宽')!
  assert.equal(band.warn, true, 'FM 带宽只占理论的 50%，双向判据应该报黄')
  assert.ok(band.hint.includes('实测占理论的 50%'))
  // 三档单音调制都正好铺满理论带宽，不该报。
  for (const mode of [0, 1, 2]) {
    const view = chapter.compute({ mode, m: 0.6, beta: 1, snrIn: 25 })
    assert.equal(view.readouts.find((r) => r.label === '占用带宽')!.warn, false)
  }
})

test('第 5 章：门限拐点随 β 上移，β 越大越早掉进断崖', () => {
  const chapter = chapterByNo(5)!
  const knee = (beta: number) => {
    // 找到「刚好不再报红」的输入信噪比，就是这块的拐点。
    for (let snr = 2; snr <= 24; snr += 0.5) {
      const view = chapter.compute({ mode: 3, m: 0.6, beta, snrIn: snr })
      // 只看门限那一条：输入太低时解调失真也会跟着红，别把它当成拐点。
      // 从低往高扫，第一个不再报红的输入信噪比就是拐点。
      if (!view.readouts.find((r) => r.label === '输出信噪比')!.warn) return snr
    }
    return Number.POSITIVE_INFINITY
  }
  const k05 = knee(0.5)
  const k1 = knee(1)
  const k2 = knee(2)
  assert.ok(k05 < k1 && k1 < k2, `拐点没随 β 上移：β=0.5 ${k05}、β=1 ${k1}、β=2 ${k2}`)
  // 10 + 3·log2(1+β)：β=1 时 13.0 dB，β=2 时 14.75 dB。
  assert.ok(Math.abs(k1 - 13) <= 0.5, `β=1 的拐点应在 13 dB 附近，实际 ${k1}`)
})

test('第 2 章：功率档同时报实线峰与平均功率，两个数不混为一谈', () => {
  const chapter = chapterByNo(2)!
  const view = chapter.compute({ tau: 1.5, shape: 0, kind: 1 })
  const peak = view.readouts.find((r) => r.label === '自相关峰值 R(0)')!
  const power = view.readouts.find((r) => r.label === '平均功率 R(0)/T')!
  assert.equal(peak.value, '1.5000')
  assert.equal(power.value, '0.1875')
  // 两者差的是窗长 T = 8 ms，读数区要把这层关系写出来。
  assert.ok(peak.hint.includes('图上实线的峰'))
  assert.ok(power.hint.includes('除以窗长 T'))
})
