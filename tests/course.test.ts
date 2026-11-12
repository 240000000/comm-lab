/**
 * 课程视图的单测。
 *
 * 判据里最容易悄悄退化的几件事都在这里钉住：
 * 13 章必须全在、只有 2/5/6/7/10 能玩、每屏参数不超过 4 个、
 * 每章的默认态不报红而「让它失效」之后必须报红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDragCoalescer } from '../src/labs/dragCommit.ts'
import {
  LEGEND_ITEM_GAP,
  legendItemWidth,
  legendRows,
  legendTextWidth,
} from '../src/labs/legendRows.ts'
import {
  COURSE_CHAPTERS,
  DEEP_LAB_CHAPTERS,
  binaryEntropy,
  channelCapacity,
  channelLimit,
  chapterByNo,
  pllLockStep,
  pllResidual,
  pllTheoryResidual,
  pllTheoryText,
  pllVerdict,
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
    // 第 12 章 R73 起多两项（当前 τ 的 R(τ)、序列前 8 位），其余章仍是 3~4 项。
    assert.ok(view.readouts.length >= 3 && view.readouts.length <= 6, `第 ${chapter.no} 章读数 ${view.readouts.length} 个`)
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

test('第 7 章：2FSK 不含 cos²φ，φ=45 时既不标红也不说「吃掉 3 dB」', () => {
  const chapter = chapterByNo(7)
  const fsk = chapter.compute({ scheme: 1, ebn0Db: 8, phaseDeg: 45 })
  // 两路正交各走各的，接收端比能量，相位误差对判决量没有影响：理论式就是 Q(√γ)，与 φ 无关。
  assert.equal(fsk.failed, false, '2FSK 的相干检测不含 cos²φ，不该被相位误差判死')
  assert.ok(!fsk.conclusion.includes('3 dB'), `2FSK 结论不该出现「3 dB」，实际：${fsk.conclusion}`)
  assert.match(fsk.conclusion, /零影响|不需要相干载波相位/)
  assert.equal(fsk.readouts[0].value, '6.00e-3', '2FSK 的理论误码率与相位误差无关')
  // 对照组：同样 45 度，2PSK 确实被 cos²φ 吃掉 3 dB，那句话得留着。
  const psk = chapter.compute({ scheme: 2, ebn0Db: 8, phaseDeg: 45 })
  assert.equal(psk.failed, true)
  assert.match(psk.conclusion, /3 dB/)
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

test('第 7 章：2DPSK 走复相关，4/6/8 dB 的实测贴着 0.5·exp(−γ)（0.6–1.6 倍）', () => {
  const chapter = chapterByNo(7)
  const rows = [4, 6, 8].map((ebn0Db) => {
    const view = chapter.compute({ scheme: 3, ebn0Db, phaseDeg: 0 })
    const theory = Number(view.readouts[0].value)
    const measured = Number(view.readouts[1].value)
    return { ebn0Db, theory, measured, ratio: measured / theory }
  })
  for (const row of rows) {
    // 理论式必须还是 0.5·exp(−γ)：γ = 10^(Eb/N0/10)。
    const gamma = 10 ** (row.ebn0Db / 10)
    // 读数只保留三位有效数字，容差按 1% 给。
    assert.ok(
      Math.abs(row.theory - 0.5 * Math.exp(-gamma)) / row.theory < 0.01,
      `${row.ebn0Db} dB 的理论值 ${row.theory} 偏离 0.5·exp(−γ)`,
    )
    // 复相关：两条支路各来一路独立噪声，判决量 Re(r1·conj(r2))，比值应当落在 1 附近。
    // 改成两个实数相乘会丢掉正交支路的噪声，比值系统性偏小到 0.5 左右。
    assert.ok(
      row.ratio >= 0.6 && row.ratio <= 1.6,
      `${row.ebn0Db} dB 的实测/理论 = ${row.ratio.toFixed(3)}，落在 0.6–1.6 之外`,
    )
  }
  // 10 dB 以上不比：20000 比特只够出几比特错，比值是统计噪声不是物理。
  const high = chapter.compute({ scheme: 3, ebn0Db: 10, phaseDeg: 0 })
  assert.ok(Number(high.readouts[1].value) * 20000 < 40, '10 dB 的错比特数太少，不能拿来比')
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
  const ber = [0, 1, 2].map(
    (wave) => chapter.compute({ ...chapter.defaults, wave }).readouts.find((r) => r.label === '误码率')!.value,
  )
  assert.equal(ber[1], ber[0])
  assert.equal(ber[2], ber[0])
  assert.equal(ber[0], '1.91e-4')
})

test('第 9 章：实测误码率落在理论值的十分之一到十倍之间', () => {
  const chapter = chapterByNo(9)
  const view = chapter.compute(chapter.defaults)
  const ber = view.readouts.find((r) => r.label === '误码率')!
  const theory = Number(ber.value)
  const hint = ber.hint
  const match = /实测 ([0-9.e-]+)/.exec(hint)
  assert.ok(match, `读数 hint 里要有实测值，实际：${hint}`)
  const measured = Number(match![1])
  assert.ok(measured > theory / 10 && measured < theory * 10, `实测 ${measured} 与理论 ${theory} 差得太远`)
})

test('第 9 章：采样点信噪比按 10·log10(2ρ²γ) 现算，峰值那条不随 Δt 变', () => {
  const chapter = chapterByNo(9)
  const pick = (dt: number, label: string) => {
    const view = chapter.compute({ ...chapter.defaults, dt })
    return view.readouts.find((r) => r.label === label)!
  }
  // 峰值信噪比只与能量有关，三档必须逐字相同——这是本章原有的结论，不能被新读数带偏。
  for (const dt of [0, 0.2, 0.4]) assert.equal(pick(dt, '峰值信噪比（理论）').value, '11.0 dB')

  assert.equal(pick(0, '采样点信噪比').value, '11.0 dB')
  // ρ(0.2 Ts) = 0.8 → 10·log10(2·0.64·6.31) = 9.07 dB，落在 9.1；不是 8.0（8.0 要 ρ≈0.707）。
  assert.equal(pick(0.2, '采样点信噪比').value, '9.1 dB')
  assert.equal(pick(0.4, '采样点信噪比').value, '6.6 dB')

  const hint = pick(0.2, '采样点信噪比').hint
  assert.ok(hint.includes('上限'), `hint 要说清峰值是上限，实际：${hint}`)
  assert.ok(hint.includes('实际拿到'), `hint 要说清这个是实际拿到的，实际：${hint}`)

  // 两个读数必须自洽：采样点信噪比 = 峰值信噪比 − 失配损失。
  for (const dt of [0, 0.2, 0.4]) {
    const peak = Number(pick(dt, '峰值信噪比（理论）').value.replace(' dB', ''))
    const loss = Number(pick(dt, '失配损失').value.replace(' dB', ''))
    const sample = Number(pick(dt, '采样点信噪比').value.replace(' dB', ''))
    assert.ok(Math.abs(peak - loss - sample) < 0.06, `dt=${dt} 三个读数不自洽：${peak} − ${loss} ≠ ${sample}`)
  }
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

test('第 12 章：换抽头就是换多项式，自相关不再只有峰值和旁瓣两个值', () => {
  const chapter = chapterByNo(12)
  const prim = chapter.compute(chapter.defaults)
  const bad = chapter.compute({ ...chapter.defaults, taps: 1 })
  assert.equal(prim.readouts[0].value, '127')
  assert.ok(Number(bad.readouts[0].value) < 127, '非本原抽头的周期必须短于 2^7-1')
  const primValues = new Set(prim.series[0].points.map(([, v]) => v.toFixed(6)))
  assert.equal(primValues.size, 2, '本原抽头下自相关只有峰值和旁瓣两个值')
  const badValues = new Set(bad.series[0].points.map(([, v]) => v.toFixed(6)))
  assert.ok(badValues.size > 2, `非本原抽头要冒出更多自相关值，实际 ${badValues.size} 种`)
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

test('第 12 章：拖 τ 时图上标出当前第几根柱，读数跟着走', () => {
  const chapter = chapterByNo(12)
  const zero = chapter.compute({ ...chapter.defaults, tau: 0 })
  const moved = chapter.compute({ ...chapter.defaults, tau: 37 })
  assert.equal(zero.markerX, 0)
  assert.equal(moved.markerX, 37)
  assert.equal(moved.markerLabel, 'τ = 37')

  const pick = (view: { readouts: Array<{ label: string; value: string }> }) =>
    view.readouts.find((r) => r.label === '当前延迟 τ 的 R(τ)')?.value
  assert.equal(pick(zero), '1.0000')
  assert.equal(pick(moved), '-0.00787')
})

test('第 12 章：读数与前 8 位跟着抽头走，不只跟着位数走', () => {
  const chapter = chapterByNo(12)
  const prim = chapter.compute(chapter.defaults)
  const bad = chapter.compute({ ...chapter.defaults, taps: 1 })
  const prefixOf = (view: { readouts: Array<{ label: string; value: string }> }) =>
    view.readouts.find((r) => r.label.startsWith('序列前 8 位'))?.value ?? ''
  assert.equal(prefixOf(prim), '11111110')
  assert.match(prefixOf(bad), /^[01]{8}$/)
  // 全 1 初态下两种抽头的前 8 位恰好都是 1 后接一个 0；真正把它们分开的是周期与自相关取值。
  assert.equal(bad.readouts[0].value, '35', '非本原抽头的周期是 35')
  const spread = (view: typeof prim) => new Set(view.series[0].points.map(([, y]) => y.toFixed(6))).size
  assert.equal(spread(prim), 2, '本原抽头的自相关只有峰值和旁瓣两个值')
  assert.ok(spread(bad) > 2, `非本原抽头要冒出更多自相关值，实际 ${spread(bad)}`)
  assert.equal(bad.readouts[0].label, '周期 N（非本原抽头）')
  assert.match(bad.series[0].name, /非本原抽头/)
  assert.match(prim.series[0].name, /n=7（N=127）/)
})


test('第 12 章：结论句说明两个值来自反馈多项式，切到非本原就掉下来', () => {
  const chapter = chapterByNo(12)
  assert.match(chapter.compute(chapter.defaults).conclusion, /来自本原抽头/)
  assert.match(chapter.compute(chapter.failPreset).conclusion, /掉到 35/)
})


test('第 12 章：竖参考线只有这一章有，别的章不传就没有', () => {
  const other = chapterByNo(2)
  assert.equal(other.compute(other.defaults).markerX, undefined)
})

test('第 8 章：章名与教材目录一致，不许退回简称', () => {
  assert.equal(chapterByNo(8).title, '新型数字带通调制技术')
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
  // R84：p 是自由参数，正确口径下任何合法取值都不该判红——反例改由「计算口径」承担。
  const view = chapter.compute({ ...chapter.defaults, p: 0.99 })
  assert.equal(view.failed, false)
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

test('第 1 章：正确口径下任何合法 p 都不判红，反例改由「计算口径」承担', () => {
  const chapter = chapterByNo(1)
  for (const p of [0.01, 0.3, 0.5, 0.8, 0.99]) {
    const view = chapter.compute({ ...chapter.defaults, p, basis: 0 })
    assert.equal(view.failed, false, `p=${p} 是合法取值，正确口径下不该判红`)
    assert.ok(!view.conclusion.includes('等于假设每个符号都同样罕见'), `p=${p} 的正确结论不该出现错档那句话`)
  }
})

test('第 1 章：错档把单次信息量当平均，方向与倍数分开断', () => {
  const chapter = chapterByNo(1)
  const view = chapter.compute({ ...chapter.defaults, p: 0.99, basis: 1 })
  assert.equal(view.failed, true)
  const info = Number(view.readouts[0].value.replace(' bit', ''))
  const entropy = Number(view.readouts[1].value.replace(' bit', ''))
  const measured = Number(view.readouts[2].value.replace(' bit', ''))
  // 错档的「实测均值」就是单次信息量本身（读数只有三位小数，取到三位再比）。
  assert.ok(Math.abs(measured - Number(selfInfo(0.99).toFixed(3))) < 1e-9, `错档的实测均值就是 I(p)，实际 ${measured} vs ${selfInfo(0.99)}`)
  assert.ok(Math.abs(info - Number(selfInfo(0.99).toFixed(2))) < 1e-9, `单次信息量读数应是 ${selfInfo(0.99)} 的两位小数`)
  assert.ok(view.conclusion.includes('单次'), `错档结论要出现「单次」，实际：${view.conclusion}`)
  assert.ok(view.conclusion.includes('平均'), `错档结论要出现「平均」，实际：${view.conclusion}`)
  assert.equal(view.readouts[2].warn, true)

  // p = 0.01：罕见事件，单次比平均大得多。方向与倍数各断一次——
  // 以前用 max(比值, 倒过来) 把方向抹平了，方向错的时候它照样是绿的。
  const low = chapter.compute({ ...chapter.defaults, p: 0.01, basis: 1 })
  const lowInfo = Number(low.readouts[0].value.replace(' bit', ''))
  const lowEntropy = Number(low.readouts[1].value.replace(' bit', ''))
  assert.ok(lowInfo > lowEntropy, `p=0.01 时 I(p) 应大于 H(p)，实际 ${lowInfo} vs ${lowEntropy}`)
  assert.ok(lowInfo / lowEntropy > 5, `p=0.01 的倍数只有 ${(lowInfo / lowEntropy).toFixed(2)}`)
  assert.ok(low.conclusion.includes('是平均的'), `p=0.01 应说「是平均的 N 倍」，实际：${low.conclusion}`)

  // p = 0.99：常见事件，单次只有平均的一小部分，方向反过来，倍数也反过来。
  assert.ok(info < entropy, `p=0.99 时 I(p) 应小于 H(p)，实际 ${info} vs ${entropy}`)
  assert.ok(entropy / info > 5, `p=0.99 反过来只有 ${(entropy / info).toFixed(2)} 倍`)
  assert.ok(view.conclusion.includes('只有平均的'), `p=0.99 应说「只有平均的 N%」，实际：${view.conclusion}`)

  // p = 0.5：读数与正确档一模一样，红在口径上——文案要把这件事说明白。
  const mid = chapter.compute({ ...chapter.defaults, p: 0.5, basis: 1 })
  assert.equal(mid.failed, true, '口径错了就该红，哪怕 p = 0.5 时两个数恰好相同')
  const midInfo = Number(mid.readouts[0].value.replace(' bit', ''))
  const midEntropy = Number(mid.readouts[1].value.replace(' bit', ''))
  assert.ok(Math.abs(midInfo - midEntropy) < 1e-9, `p=0.5 时 I 与 H 应相等，实际 ${midInfo} vs ${midEntropy}`)
  assert.ok(mid.conclusion.includes('恰好'), `p=0.5 的结论要点明「恰好」，实际：${mid.conclusion}`)
  assert.ok(mid.conclusion.includes('看不出来'), `p=0.5 的结论要说明「看不出来」，实际：${mid.conclusion}`)
})

test('第 1 章：错档文案里的倍数/百分比与实算比值一致，改文案不许跑偏', () => {
  const chapter = chapterByNo(1)
  for (const p of [0.01, 0.5, 0.9, 0.99]) {
    const view = chapter.compute({ ...chapter.defaults, p, basis: 1 })
    const info = selfInfo(p)
    const entropy = binaryEntropy(p)
    const ratio = info / entropy
    if (Math.abs(info - entropy) < 1e-9) {
      // 相等那一档不许再说「N 倍」——那正是原来的病灶。
      assert.ok(!/平均的 \d+(\.\d+)? 倍/.test(view.conclusion), `p=${p} 两数相等，不该出现「N 倍」：${view.conclusion}`)
      continue
    }
    if (ratio > 1) {
      const m = view.conclusion.match(/是平均的 (\d+\.\d+) 倍/)
      assert.ok(m, `p=${p} 的结论应写「是平均的 N 倍」，实际：${view.conclusion}`)
      assert.ok(Math.abs(Number(m[1]) - ratio) < 0.01, `p=${p} 写的是 ${m[1]} 倍，实算 ${ratio.toFixed(4)}`)
    } else {
      const pct = view.conclusion.match(/只有平均的 (\d+\.\d)%/)
      const inv = view.conclusion.match(/反过来平均是单次的 (\d+\.\d+) 倍/)
      assert.ok(pct, `p=${p} 的结论应写「只有平均的 N%」，实际：${view.conclusion}`)
      assert.ok(inv, `p=${p} 的结论应给出反向倍数，实际：${view.conclusion}`)
      // 百分比只保留一位小数（误差 ≤ 0.05），倍数两位（误差 ≤ 0.005）。
      assert.ok(Math.abs(Number(pct[1]) - ratio * 100) < 0.06, `p=${p} 写的是 ${pct[1]}%，实算 ${(ratio * 100).toFixed(3)}%`)
      assert.ok(Math.abs(Number(inv[1]) - 1 / ratio) < 0.01, `p=${p} 反向写的是 ${inv[1]} 倍，实算 ${(1 / ratio).toFixed(4)}`)
    }
    // 读数卡上的 hint 用的是同一句话，也要对得上（这里只查 p=0.99 这一档的百分比）。
    if (p === 0.99) {
      const hintPct = view.readouts[2].hint.match(/只有平均的 (\d+\.\d)%/)
      assert.ok(hintPct, `错档 hint 应说明百分比，实际：${view.readouts[2].hint}`)
      assert.ok(Math.abs(Number(hintPct[1]) - ratio * 100) < 0.06, `hint 写的是 ${hintPct[1]}%，实算 ${(ratio * 100).toFixed(3)}%`)
    }
  }
})

test('第 1 章：失效档指向错档，默认档仍是正确的概率加权', () => {
  const chapter = chapterByNo(1)
  assert.equal(chapter.failPreset.basis, 1)
  assert.equal(chapter.failPreset.p, 0.99)
  assert.equal(chapter.compute(chapter.failPreset).failed, true)
  const normal = chapter.compute({ ...chapter.defaults })
  assert.equal(normal.failed, false)
  assert.equal(normal.readouts[0].value, '1.00 bit')
  assert.equal(normal.readouts[1].value, '1.000 bit')
  assert.equal(normal.readouts[2].value, '1.000 bit')
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

test('第 3 章：非平稳档的理论均值随时间漂，读数不再是 0.000', () => {
  const chapter = chapterByNo(3)
  const drifted = chapter.compute({ kind: 2, timeIndex: 3, k: 100 })
  const theory = drifted.readouts.find((r) => r.label === '理论统计平均')!
  // 末时刻期望 E[x(T)] = c·T = 2 × 0.1 s = 0.200，报 0.000 与本章论点直接冲突。
  assert.notEqual(theory.value, '0.000')
  assert.equal(theory.value, '0.200')
  assert.ok(theory.hint.includes('c·t'), `hint 要交代这个数的来历，实际：${theory.hint}`)

  // 容许带的中心跟着这条理论均值走：0.200、0.200 + 4σ_T、0.200 − 4σ_T。
  const drawn = drifted.guides!.map((g) => g.y.toFixed(3))
  assert.deepEqual(drawn, ['0.200', '0.326', '0.074'])
  // 带外比例仍是设计出来的失效信号。
  const outside = drifted.readouts.find((r) => r.label.startsWith('带外比例'))!
  assert.equal(outside.value, '92.0 %')
  assert.equal(drifted.failed, true)

  // 平稳档仍报 0.000——带心只在非平稳档移位。
  for (const kind of [0, 1]) {
    const still = chapter.compute({ kind, timeIndex: 3, k: 100 }).readouts.find((r) => r.label === '理论统计平均')!
    assert.equal(still.value, '0.000', `kind=${kind} 是平稳过程，理论均值就该是 0`)
  }
})

test('第 3 章：同一档连跑两次读数与结论逐字相同', () => {
  const chapter = chapterByNo(3)
  const a = chapter.compute({ kind: 2, timeIndex: 3, k: 100 })
  const b = chapter.compute({ kind: 2, timeIndex: 3, k: 100 })
  assert.equal(a.conclusion, b.conclusion)
  assert.deepEqual(a.readouts.map((r) => r.value), b.readouts.map((r) => r.value))
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
  assert.equal(view.readouts[2].value, '发散')
  assert.ok(view.conclusion.includes('放大'))
})

test('第 13 章：理论稳态残余按 σ/√(2K−K²) 报，K ≥ 2 报发散', () => {
  // σ = 0 时理论值就是 0；K ≥ 2 时没有稳态，返回 null。
  assert.equal(pllTheoryResidual(0.6, 0), 0)
  assert.equal(pllTheoryResidual(2.5, 0.1), null)
  assert.equal(pllTheoryResidual(2, 0.1), null)
  assert.equal(pllTheoryText(2.5, 0.1), '发散，无稳态')
  // 0.1 / √(2·0.6 − 0.36) = 0.1 / √0.84 ≈ 0.109109
  assert.ok(Math.abs(pllTheoryResidual(0.6, 0.1)! - 0.1091089) < 1e-6)
  assert.equal(pllTheoryText(0.6, 0.1), '0.109')
  assert.equal(pllTheoryText(1.5, 0.1), '0.115')
})

test('第 13 章：八格判定表——K=0.6、σ=0.1 锁住，K=2.5 发散，K=0.05、σ=0 未收敛', () => {
  const verdictOf = (k: number, sigma: number) => pllVerdict(k, pllTrace(k, 2, sigma, 20261112), sigma)
  assert.equal(verdictOf(0.05, 0), '未收敛')
  assert.equal(verdictOf(0.6, 0), '锁住')
  assert.equal(verdictOf(0.6, 0.1), '锁住')
  assert.equal(verdictOf(1.5, 0), '锁住')
  assert.equal(verdictOf(1.5, 0.1), '锁住')
  assert.equal(verdictOf(2.5, 0), '发散')
  assert.equal(verdictOf(2.5, 0.1), '发散')
  // 判定与读数一致：只有「锁住」才不是 failed。
  for (const k of [0.05, 0.6, 1.5, 2.5]) {
    const view = chapterByNo(13)!.compute({ k, theta0: 2, sigma: 0 })
    assert.equal(view.failed, view.readouts[2].value !== '锁住')
  }
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

test('第 5 章：FM 的 β 就是调频指数 D，β=2 时 Carson 上限 9.00 kHz、输出 40.6 dB', () => {
  const chapter = chapterByNo(5)!
  const view = chapter.compute({ mode: 3, m: 0.6, beta: 2, snrIn: 25 })
  const out = Number.parseFloat(view.readouts.find((r) => r.label === '输出信噪比')!.value)
  // 消息归一化到导数峰值 1 之后 D=Δf/fm=β，制度增益 3β²(β+1)=36 → 15.56 dB → 25+15.56。
  assert.ok(Math.abs(out - 40.6) < 0.2, `β=2 的输出信噪比 ${out} dB，偏离 40.6 超过 0.2 dB`)
  // Carson 上限 2(β+1)·fm = 2·3·1.5 = 9.00 kHz；98% 能量带宽实测 7.00 kHz，占 78%，在 30% 以内不报黄。
  const band = view.readouts.find((r) => r.label === '占用带宽')!
  assert.equal(band.value, '7.00 kHz')
  assert.equal(band.warn, false, '实测占理论 78%，偏离不到 30%，不该报黄')
  assert.match(view.conclusion, /Carson 上限 9\.00 kHz/)
  assert.match(view.conclusion, /78%/)
})

test('第 5 章：带宽 warn 是双向的，实测比理论小 30% 以上也报红', () => {
  const chapter = chapterByNo(5)!
  // 消息归一化之后，β=1 的 98% 能量带宽只有 Carson 上限的 67%（4.00 / 6.00 kHz），
  // 偏离超过 30%，旧的单向判据（只报超出）不会报。
  const fm = chapter.compute({ mode: 3, m: 0.6, beta: 1, snrIn: 25 })
  const band = fm.readouts.find((r) => r.label === '占用带宽')!
  assert.equal(band.warn, true, 'FM 带宽只占理论的 67%，双向判据应该报黄')
  assert.ok(band.hint.includes('实测占理论的 67%'))
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

test('第 5 章：换参数图必变——调制度与输入信噪比都能在图上看出来', () => {
  const chapter = chapterByNo(5)!
  const pointsOf = (patch: Record<string, number>) =>
    chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 25, ...patch })
      .series[1].points.map((q) => q[1])
  const maxDiff = (a: number[], b: number[]) => {
    let d = 0
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]))
    return d
  }
  // 加噪之前这四条序列逐位相同，图上看不出任何变化。
  assert.ok(maxDiff(pointsOf({ m: 0.2 }), pointsOf({ m: 1.0 })) > 0.1, 'm=0.2 与 m=1.0 的绘图序列应当明显不同')
  assert.ok(maxDiff(pointsOf({ snrIn: 5 }), pointsOf({ snrIn: 25 })) > 0.5, '输入 5 dB 与 25 dB 的绘图序列应当明显不同')
})

test('第 5 章：噪声按输出信噪比标定，同一档两次算出来逐点相同', () => {
  const chapter = chapterByNo(5)!
  const view = chapter.compute({ mode: 3, m: 0.6, beta: 2, snrIn: 25 })
  const again = chapter.compute({ mode: 3, m: 0.6, beta: 2, snrIn: 25 })
  assert.deepEqual(view.series[1].points, again.series[1].points, '同参数必须逐点复现，不许用 Math.random')
  assert.equal(view.series[1].name, '解调输出（含噪声）')
  // 两个 σ 不同的档相减，差值序列就是两条独立噪声之差：均方根应贴着 √(σ₁²+σ₂²)。
  const sigmaOf = (value: string) => Math.pow(10, -Number.parseFloat(value) / 20)
  const low = chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 5 })
  const high = chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 25 })
  const sLow = sigmaOf(low.readouts.find((r) => r.label === '输出信噪比')!.value)
  const sHigh = sigmaOf(high.readouts.find((r) => r.label === '输出信噪比')!.value)
  let sum = 0
  const n = high.series[1].points.length
  for (let i = 0; i < n; i++) sum += (low.series[1].points[i][1] - high.series[1].points[i][1]) ** 2
  const rms = Math.sqrt(sum / n)
  const expect = Math.sqrt(sLow * sLow + sHigh * sHigh)
  assert.ok(Math.abs(rms - expect) / expect < 0.15, `噪声均方根 ${rms.toFixed(3)} 应贴着 √(σ₁²+σ₂²)=${expect.toFixed(3)}`)
  assert.ok(view.conclusion.includes('标了噪声'))
})

test('第 5 章：三个读数仍走理想路径，加噪之后逐字不变', () => {
  const chapter = chapterByNo(5)!
  const full = chapter.compute({ mode: 0, m: 1.0, beta: 2, snrIn: 25 })
  assert.equal(full.readouts.find((r) => r.label === '解调失真')!.value, '0.0%')
  assert.equal(full.readouts.find((r) => r.label === '输出信噪比')!.value, '23.2 dB')
  const fm = chapter.compute({ mode: 3, m: 0.6, beta: 8, snrIn: 25 })
  assert.equal(fm.readouts.find((r) => r.label === '输出信噪比')!.value, '57.4 dB')
  const low = chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 5 })
  assert.equal(low.readouts.find((r) => r.label === '输出信噪比')!.value, '-0.2 dB')
})

test('第 5 章：结论句按图上噪声分档，σ < 0.15 才说「贴着消息」', () => {
  const chapter = chapterByNo(5)!
  // σ = 0.1023，图上只有细毛刺——这一档才配说「贴着消息」。
  const clean = chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 25 })
  assert.match(clean.conclusion, /解调输出贴着消息/)
  assert.match(clean.conclusion, /按理想路径算/)
  assert.doesNotMatch(clean.conclusion, /已经被噪声盖住/)
})

test('第 5 章：σ 跨过 0.15 与 0.5 时结论句换档，中档说起毛', () => {
  const chapter = chapterByNo(5)!
  // σ = 0.3236，落在 0.15 与 0.5 之间。
  const mid = chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 15 })
  assert.match(mid.conclusion, /开始起毛/)
  assert.match(mid.conclusion, /还能看出消息形状/)
  assert.doesNotMatch(mid.conclusion, /贴着消息/)
})

test('第 5 章：噪声盖住图时结论句直说图上看不出消息，读数口径也写清', () => {
  const chapter = chapterByNo(5)!
  // σ = 1.0233，线基本被埋掉；失真仍按理想路径算 0.0%，不能说成从图上量的。
  const buried = chapter.compute({ mode: 0, m: 0.6, beta: 2, snrIn: 5 })
  assert.match(buried.conclusion, /已经被噪声盖住/)
  assert.match(buried.conclusion, /图上看不出消息/)
  assert.match(buried.conclusion, /失真读数仍按理想路径算，是 0\.0%/)
  assert.doesNotMatch(buried.conclusion, /贴着消息/)
  const hint = buried.readouts.find((r) => r.label === '输出信噪比')!.hint
  assert.match(hint, /图上已被噪声盖住/)
})

test('第 2 章：功率档报平均功率与相邻峰间隔，两个数分别对应 P = E/Tp 和 Tp', () => {
  const chapter = chapterByNo(2)!
  const view = chapter.compute({ tau: 1.5, shape: 0, kind: 1 })
  const power = view.readouts.find((r) => r.label === '平均功率 P')!
  const spacing = view.readouts.find((r) => r.label === '相邻峰间隔')!
  // τ = 1.5 时 2τ = 3，取能整除 8 且 ≥ 3 的最小周期 Tp = 4；矩形脉冲 E = 1.5，P = 1.5/4。
  assert.equal(power.value, '0.3750')
  assert.equal(spacing.value, '4.00 ms')
  assert.ok(power.hint.includes('E / Tp'), `平均功率的 hint 应写清 P = E / Tp，实际 ${power.hint}`)
  assert.ok(power.hint.includes('4.00'), `平均功率的 hint 应带上当前 Tp，实际 ${power.hint}`)
})

test('第 2 章：能量档两条线逐点相等，功率档两条线也逐点相等', () => {
  const chapter = chapterByNo(2)!
  const energy = chapter.compute({ ...chapter.defaults, kind: 0 })
  assert.deepEqual(energy.series[0].points, energy.series[1].points)
  assert.equal(energy.failed, false)

  const power = chapter.compute({ ...chapter.defaults, kind: 1 })
  assert.deepEqual(power.series[0].points, power.series[1].points)
  // 周期脉冲串的峰是平均功率 P = E/Tp = 1.5/4，不是除窗长 T 得到的 0.1875。
  const peak = Math.max(...power.series[0].points.map((p) => p[1]))
  assert.ok(Math.abs(peak - 0.375) < 1e-9, `功率档图上峰值应为 0.375，实际 ${peak}`)
  assert.equal(power.failed, false)
})

test('第 2 章：功率档的峰按周期重复，±Tp 处与零延迟同高、远处不衰到零', () => {
  const chapter = chapterByNo(2)!
  const view = chapter.compute({ tau: 1.5, shape: 0, kind: 1 })
  const points = view.series[0].points
  const near = (x: number) => {
    let best = points[0]
    for (const p of points) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p
    return best[1]
  }
  const zero = near(0)
  const minusTp = near(-4)
  assert.ok(Math.abs(zero - 0.375) < 1e-9, `零延迟峰应为 0.375，实际 ${zero}`)
  assert.ok(Math.abs(minusTp - zero) < 1e-9, `−Tp 处的峰应与零延迟同高，实际 ${minusTp} vs ${zero}`)
  // 能量信号在脉冲外归零；周期信号的功率有限，τ 再大也还在同一量级。
  const tail = points.filter((p) => Math.abs(p[0]) > 2)
  const tailMax = Math.max(...tail.map((p) => Math.abs(p[1])))
  assert.ok(tailMax > 0.3, `|τ| > 2 之后仍应有峰，实际最大 ${tailMax}`)
})

test('第 2 章：能量档在 |τ| > τ 之外确实归零，只有一个峰', () => {
  const chapter = chapterByNo(2)!
  const view = chapter.compute({ tau: 1.5, shape: 0, kind: 0 })
  const points = view.series[0].points
  const outside = points.filter((p) => Math.abs(p[0]) > 1.6)
  const outsideMax = Math.max(...outside.map((p) => Math.abs(p[1])))
  assert.ok(outsideMax < 1e-9, `能量档脉冲外应归零，实际最大 ${outsideMax}`)
  const peaks = points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return false
    return p[1] >= points[i - 1][1] && p[1] >= points[i + 1][1] && p[1] > 1e-6
  })
  assert.equal(peaks.length, 1, `能量档只该有一个峰，实际 ${peaks.length} 个`)
})

test('第 2 章：两档的图必须逐点不相等（防止以后又被归一化成一个样）', () => {
  const chapter = chapterByNo(2)!
  for (const tau of [0.5, 1.5]) {
    const energy = chapter.compute({ tau, shape: 0, kind: 0 }).series[0].points
    const power = chapter.compute({ tau, shape: 0, kind: 1 }).series[0].points
    assert.equal(energy.length, power.length)
    const same = energy.every((p, i) => Math.abs(p[1] - power[i][1]) < 1e-9)
    assert.equal(same, false, `τ=${tau} 时两档的曲线不该完全相同`)
  }
})

test('第 2 章：周期 Tp 整除窗长 8，且整段里装得下一个完整脉冲', () => {
  const chapter = chapterByNo(2)!
  for (const tau of [0.2, 0.5, 1.5, 2, 3, 4]) {
    const view = chapter.compute({ tau, shape: 0, kind: 1 })
    const spacing = Number(view.readouts.find((r) => r.label === '相邻峰间隔')!.value.replace(' ms', ''))
    assert.equal(Number.isInteger(8 / spacing), true, `τ=${tau} 的 Tp=${spacing} 没有整除 8`)
    assert.ok(spacing >= 2 * tau - 1e-9, `τ=${tau} 的 Tp=${spacing} 装不下一个完整脉冲`)
  }
})

test('第 2 章：把幅度谱当功率谱，形状变了、对偶偏差到 0.9 量级', () => {
  const chapter = chapterByNo(2)!
  const view = chapter.compute({ ...chapter.failPreset, kind: 2 })
  const deviation = Number(view.readouts.find((r) => r.label === '对偶偏差')!.value)
  assert.ok(deviation > 0.9, `反例档对偶偏差应在 0.9 以上，实际 ${deviation}`)
  assert.equal(view.failed, true)
})

test('第 2 章：相关峰宽度按半高全宽报，读数和 hint 里的脉宽不许各说各话', () => {
  const chapter = chapterByNo(2)!
  for (const kind of [0, 1]) {
    const view = chapter.compute({ tau: 1.5, shape: 0, kind })
    const readout = view.readouts.find((r) => r.label === '相关峰宽度')!
    const width = Number(readout.value.replace(' ms', ''))
    assert.ok(Math.abs(width - 1.5) < 0.05, `kind=${kind} 半高全宽应≈1.50 ms，实际 ${width}`)
    const theory = Number(readout.hint.match(/脉宽 ([\d.]+) ms/)![1])
    assert.ok(
      Math.abs(width - theory) / theory < 0.05,
      `kind=${kind} 读数 ${width} 与 hint 里的 ${theory} 差超过 5%`,
    )
  }
})

test('第 2 章：τ = 0.5 与 τ = 2.0 也自洽，不是只有默认档凑对', () => {
  const chapter = chapterByNo(2)!
  for (const tau of [0.5, 2]) {
    for (const kind of [0, 1]) {
      const view = chapter.compute({ tau, shape: 0, kind })
      const readout = view.readouts.find((r) => r.label === '相关峰宽度')!
      const width = Number(readout.value.replace(' ms', ''))
      assert.ok(Math.abs(width - tau) < tau * 0.05, `τ=${tau} kind=${kind} 半高全宽应≈${tau} ms，实际 ${width}`)
      const theory = Number(readout.hint.match(/脉宽 ([\d.]+) ms/)![1])
      assert.ok(
        Math.abs(width - theory) / theory < 0.05,
        `τ=${tau} kind=${kind} 读数 ${width} 与 hint 里的 ${theory} 差超过 5%`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// R58：拖动期间隔一帧算一次，松手必须补算成全精度
// ---------------------------------------------------------------------------

test('拖动节流：不拖动时每次变化都提交，拖动时隔一次提交一次', () => {
  const seen: number[] = []
  const c = createDragCoalescer<number>()

  // 不在拖动中：键盘改值、点一下轨道，都该立刻算。
  c.push(1, (v) => seen.push(v))
  c.push(2, (v) => seen.push(v))
  assert.deepEqual(seen, [1, 2])

  // 拖动中：6 次变化只算 3 次，且算的是第 1、3、5 次。
  seen.length = 0
  c.begin()
  for (let v = 3; v <= 8; v++) c.push(v, (x) => seen.push(x))
  assert.deepEqual(seen, [3, 5, 7])
  assert.equal(c.live(), 8)
  assert.equal(c.dragging(), true)
})

test('拖动节流：松手用最后一次的值补算，结果与一次没省完全相同', () => {
  const committed: Array<Record<string, number>> = []
  const commit = (v: Record<string, number>) => committed.push(v)
  const c = createDragCoalescer<Record<string, number>>()

  const ch6 = chapterByNo(6)
  c.begin()
  // 模拟把 α 从 0.35 一路拖到 0.05，中间每帧一次。
  let live = { ...ch6.defaults }
  const trail: Array<Record<string, number>> = []
  for (let alpha = 0.3; alpha >= 0.05; alpha -= 0.05) {
    live = { ...live, alpha: Number(alpha.toFixed(2)) }
    trail.push(live)
    c.push(live, commit)
  }
  c.end(commit)

  // 松手后喂给 compute 的，就是最后一次的完整参数。
  assert.equal(committed[committed.length - 1], live)
  // 中间帧确实被省掉了一部分（不是全算也不是全不算）。
  assert.ok(committed.length < trail.length)
  assert.ok(committed.length > 1)

  // 判定口径：拖动路径的读数、结论、失效判据，与直接用最后一次参数算的一字不差。
  const viaDrag = ch6.compute(committed[committed.length - 1])
  const direct = ch6.compute(live)
  assert.deepEqual(viaDrag.readouts, direct.readouts)
  assert.equal(viaDrag.conclusion, direct.conclusion)
  assert.equal(viaDrag.failed, direct.failed)
})

test('拖动节流：两次拖动各自独立，第二次不会继承上一次的跳过位', () => {
  const seen: number[] = []
  const c = createDragCoalescer<number>()

  c.begin()
  c.push(1, (v) => seen.push(v))
  c.push(2, (v) => seen.push(v))
  c.end((v) => seen.push(v))
  assert.deepEqual(seen, [1, 2])

  // 第二轮从「该提交」开始，而不是接着上一轮的跳过位。
  seen.length = 0
  c.begin()
  c.push(3, (v) => seen.push(v))
  c.push(4, (v) => seen.push(v))
  c.end((v) => seen.push(v))
  assert.deepEqual(seen, [3, 4])
})

test('图例折行：第 1/6/11/12 章在三种容器宽下每行都不超宽，条数不多不少', () => {
  const cases = [
    { no: 1, expect: 3 },
    { no: 6, expect: 2 },
    { no: 11, expect: 3 },
    { no: 12, expect: 1 },
  ]
  for (const item of cases) {
    const chapter = chapterByNo(item.no)
    assert.ok(chapter?.compute, `第 ${item.no} 章应当有计算函数`)
    const series = chapter.compute(chapter.defaults).series
    const visible = series.filter((s) => !s.quiet)
    assert.equal(visible.length, item.expect, `第 ${item.no} 章图例条数`)
    for (const maxWidth of [760, 600, 420]) {
      const layout = legendRows(series, maxWidth)
      // 条数自洽：每行几条加起来正好是可见 series 数，行数与每行条数一一对应。
      assert.equal(layout.rows.reduce((a, b) => a + b, 0), visible.length)
      assert.equal(layout.totalRows, layout.rows.length)
      assert.ok(layout.totalRows >= 1)
      assert.equal(layout.widestRow, Math.max(...layout.widths))
      // 每行总宽都不超过容器宽——这就是「永远不遮图、永不重合」的可测形式。
      for (const width of layout.widths) {
        assert.ok(width <= maxWidth, `第 ${item.no} 章有行宽 ${width} 超过容器 ${maxWidth}`)
      }
      assert.equal(layout.overflow, false, `第 ${item.no} 章在 ${maxWidth} 宽下不该有单条超宽`)
    }
  }
})

test('图例折行：第 6 章名字最长，窄容器下先换行而不是截断', () => {
  const chapter = chapterByNo(6)
  assert.ok(chapter?.compute)
  const series = chapter.compute(chapter.defaults).series
  const names = series.filter((s) => !s.quiet).map((s) => s.name)
  assert.deepEqual(names, ['上包络（最坏的那个码元）', '下包络（最坏的那个码元）'])
  // 名字一个字都不省：估算宽度按完整名字算。
  assert.ok(legendTextWidth(names[0]) > 100)
  assert.equal(legendItemWidth(names[0]), 26 + 6 + legendTextWidth(names[0]))
  // 宽容器下排一行，窄容器下换两行，两种情况条数都一样多。
  const wide = legendRows(series, 760)
  const narrow = legendRows(series, 300)
  assert.deepEqual(wide.rows, [2])
  assert.deepEqual(narrow.rows, [1, 1])
  assert.equal(narrow.rows.reduce((a, b) => a + b, 0), 2)
  // 两行之间的间距是条目间距，第 12 章的 4 条堆叠在同一条 100 像素里也不会互相压。
  assert.ok(narrow.widths.every((w) => w <= 300))
  assert.ok(legendItemWidth(names[0]) + LEGEND_ITEM_GAP + legendItemWidth(names[1]) > 300)
})

test('图例折行：单条就比容器宽时不裁字，独占一行并报 overflow', () => {
  const series = [{ name: '上包络（最坏的那个码元）' }, { name: '静默放行' }]
  const layout = legendRows(series, 80)
  assert.equal(layout.overflow, true)
  assert.deepEqual(layout.rows, [1, 1])
  assert.ok(layout.widths[0] > 80)
})

test('图例折行：quiet 的 series 不进图例也不参与折行', () => {
  const series = [{ name: '甲' }, { name: '乙', quiet: true }, { name: '丙' }]
  const layout = legendRows(series, 760)
  assert.deepEqual(layout.rows, [2])
  assert.equal(layout.totalRows, 1)
})

test('第 10 章：主图画的是量化误差 e(t)，抽样率与位数都改它', () => {
  const chapter = chapterByNo(10)!
  const errOf = (patch: Record<string, number>) => chapter.compute({ ...chapter.defaults, ...patch }).series[0]
  const peak = (s: { points: Array<[number, number]> }) => Math.max(...s.points.map(([, y]) => Math.abs(y)))
  const base = errOf({})
  assert.match(base.name, /量化误差 e\(t\)/)
  assert.match(base.name, /8 bit/, 'series 名要带当前位数')
  // 只在采样时刻取误差：fs=4、4 秒 → 4·fs = 16 个采样点。
  assert.equal(base.points.length, 16, '误差曲线每个采样点一个值')
  // 位数越多台阶越细：12 bit 的误差峰值得掉到 8 bit 的 1/10 以下。
  const fine = errOf({ bits: 12 })
  assert.match(fine.name, /12 bit/)
  assert.ok(peak(fine) < peak(base) / 10, `12 bit 误差峰值 ${peak(fine)} 没有明显小于 8 bit 的 ${peak(base)}`)
  // 抽样率改的是采样点的疏密：fs=8 点数翻倍，且每个点的误差取值跟着变。
  const fast = errOf({ fs: 8 })
  assert.equal(fast.points.length, 32, 'fs=8 时采样点翻倍')
  assert.notDeepEqual(fast.points.slice(0, 16).map(([, y]) => y), base.points.map(([, y]) => y))
  const slow = errOf({ fs: 1 })
  assert.equal(slow.points.length, 4, 'fs=1 时只有每周期 1 个采样点')
  // 纵轴钉死 ±0.05，换章节参数不会自己缩放。
  assert.deepEqual(chapter.compute(chapter.defaults).yRange, [-0.05, 0.05])
  // A 律压扩也是一条独立口径：台阶按幅度重排，误差曲线与均匀量化不同。
  const companded = errOf({ compand: 1 })
  assert.match(companded.name, /A 律/)
  assert.notDeepEqual(companded.points.map(([, y]) => y), base.points.map(([, y]) => y))
})


test('第 10 章：重建链换成抽样-量化之后，三个读数逐字没变', () => {
  const chapter = chapterByNo(10)!
  const pick = (view: ReturnType<typeof chapter.compute>, label: string) =>
    view.readouts.find((r) => r.label === label)?.value
  const base = chapter.compute({ fs: 4, bits: 8, compand: 0 })
  assert.equal(pick(base, '混叠误差'), '0.00e+0')
  assert.equal(pick(base, '量化信噪比'), '49.99 dB')
  assert.equal(pick(base, 'PCM 码率'), '32.0 kb/s')
  const low = chapter.compute({ fs: 1, bits: 8, compand: 0 })
  assert.equal(pick(low, '混叠误差'), '173.3%')
  assert.equal(pick(low, '量化信噪比'), '49.99 dB')
  assert.equal(pick(low, 'PCM 码率'), '8.0 kb/s')
  assert.equal(low.failed, true, '抽样率低于 2 f_H 该判红')
})

test('第 10 章：压扩档的重建链里确实走了 A 律压扩', () => {
  const chapter = chapterByNo(10)!
  const uniform = chapter.compute({ fs: 1.4, bits: 8, compand: 0 })
  const companded = chapter.compute({ fs: 1.4, bits: 8, compand: 1 })
  const u = uniform.series[0].points
  const c = companded.series[0].points
  assert.equal(c.length, u.length, '两档的抽样点数该一样')
  // 主图是量化误差 e(t)：压扩改变台阶间距，误差曲线跟着变，两档逐点最多差多少就是压扩进没进链路的证据。
  let worst = 0
  for (let i = 0; i < u.length; i += 1) worst = Math.max(worst, Math.abs(u[i][1] - c[i][1]))
  // 压扩把台阶按幅度重新分配，不是平移抽样时刻：差异量级 5e-3。
  assert.ok(worst > 0.003, `A 律与均匀的量化误差曲线差 ${worst} 太小，压扩可能没进重建链`)
  assert.equal(
    companded.readouts.find((r) => r.label === '量化信噪比（A 律）')?.value,
    '38.59 dB',
    'A 律读数被重建链改动了',
  )
})

test('第 9 章：接收噪声那条线一直在，失配那条只在 dt>0 时出现', () => {
  const chapter = chapterByNo(9)
  const onTime = chapter.compute({ ...chapter.defaults, dt: 0 })
  const late = chapter.compute({ ...chapter.defaults, dt: 0.3 })
  assert.equal(onTime.series.length, 4, 'dt=0 时是三条波形加一条接收噪声实现')
  assert.ok(onTime.series.some((s) => s.name.startsWith('接收噪声实现')))
  assert.ok(!onTime.series.some((s) => s.name === '失配后的相关输出'))
  assert.equal(late.series.length, 5, 'dt>0 时再多出失配那条')
  const mismatch = late.series.find((s) => s.name === '失配后的相关输出')
  assert.equal(mismatch?.dashed, true)
  const noise = onTime.series.find((s) => s.name.startsWith('接收噪声实现'))
  assert.match(noise?.name ?? '', /σ = 0\.\d{3}/)
  assert.equal(noise?.dashed, true)
  assert.ok((noise?.points.length ?? 0) > 0, '噪声折线要有采样点')
})


test('第 9 章：失配把相关峰推后 dt、压到 ρ 倍，读数仍是 4.44 dB', () => {
  const chapter = chapterByNo(9)!
  const peakOf = (dt: number) => {
    const view = chapter.compute({ ...chapter.defaults, dt })
    const curve = view.series.find((s) => s.name === '失配后的相关输出')
    if (!curve) return null
    let peak = -Infinity
    let at = 0
    for (const [x, y] of curve.points) {
      if (y > peak) {
        peak = y
        at = x
      }
    }
    return { peak, at, view }
  }
  const half = peakOf(0.2)!
  const forty = peakOf(0.4)!
  assert.ok(Math.abs(half.at - 0.2) < 0.02, `dt=0.2 的峰跑到 ${half.at}`)
  assert.ok(Math.abs(half.peak - 0.8) < 0.01, `dt=0.2 的峰高 ${half.peak} 不是 0.8`)
  assert.ok(Math.abs(forty.at - 0.4) < 0.02, `dt=0.4 的峰跑到 ${forty.at}`)
  assert.ok(Math.abs(forty.peak - 0.6) < 0.01, `dt=0.4 的峰高 ${forty.peak} 不是 0.6`)
  const loss = (view: ReturnType<typeof chapter.compute>) =>
    view.readouts.find((r) => r.label === '失配损失')?.value
  assert.equal(loss(chapter.compute({ ...chapter.defaults, dt: 0 })), '0.00 dB')
  assert.equal(loss(forty.view), '4.44 dB')
  assert.equal(
    forty.view.readouts.find((r) => r.label === '峰值信噪比（理论）')?.value,
    '11.0 dB',
    '峰值信噪比不该被绘图用的那条线带偏',
  )
})
