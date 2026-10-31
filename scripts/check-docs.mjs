#!/usr/bin/env node
/**
 * 文档数字复算。`npm run check:docs`
 *
 * 文档里那些"手抄"的数字（测试条数、BER、EVM、自由距离、子载波数、耗时）
 * 一律在这里用 `src/core` 的同一套函数重算，再回读 README 与 docs/ 下的正文比对。
 * 对不上就退出码 1，并打印文件、行号、文档写的值和实际值。
 *
 * 只查"当前状态"的三份文件：README.md、docs/preview.md、docs/tech-report.md。
 * docs/dialogues/ 是逐字存档，里面的旧数字是历史，不参与复算。
 *
 * 耗时类断言用 10 倍宽带比对（band），因为墙钟随机器与负载变；其余数字按
 * 印刷精度卡（整数严格相等，BER/理论 1%，EVM 0.01 个百分点）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { simulateAwgn } from '../src/core/metrics.ts';
import { bitsPerSymbol, QAM_ORDERS } from '../src/core/qam.ts';
import { theoryBer } from '../src/core/ber.ts';
import { sweepBer } from '../src/core/curve.ts';
import { sweepConv } from '../src/core/convCurve.ts';
import { freeDistance, correctionCapability } from '../src/core/conv.ts';
import { runOfdm, SUBCARRIERS } from '../src/core/ofdm.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILES = ['README.md', 'docs/preview.md', 'docs/tech-report.md'];

const SEED = 20261027; // 三个实验台的默认种子
const PAGE_BITS = 20000; // QAM 页默认统计样本（按比特取整）

const EXACT = { abs: 0 };
const PRINTED = { rel: 0.01 }; // 三位有效数字
const EVM = { abs: 0.01 };
const TIMING = { band: 10 };

const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function timed(fn, runs) {
  let value;
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = now();
    value = fn();
    samples.push(now() - t0);
  }
  return { ms: median(samples), value };
}

// ── 1. 测试条数：直接跑一遍 node --test，从输出里读 ─────────────────────────
const testFileCount = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts')).length;
const testRun = spawnSync(process.execPath, ['--test'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});
const testOutput = `${testRun.stdout ?? ''}\n${testRun.stderr ?? ''}`;
const testCountMatch = testOutput.match(/^(?:ℹ|#) tests (\d+)$/m);
if (testRun.status !== 0 || !testCountMatch) {
  console.error('check-docs: `node --test` 没跑通，读不到用例数');
  console.error(testOutput.split('\n').filter((l) => /fail|tests|not ok/.test(l)).slice(0, 12).join('\n'));
  process.exit(1);
}
const testCount = Number(testCountMatch[1]);

// ── 2. QAM：页面默认四档（12 dB，按 20,000 比特截断） ──────────────────────
const pageStats = new Map();
for (const order of QAM_ORDERS) {
  const symbolCount = Math.ceil(PAGE_BITS / bitsPerSymbol(order));
  pageStats.set(order, simulateAwgn({ order, snrDb: 12, symbolCount, seed: SEED }));
}

// 16QAM 0 dB / 20,000 符号，preview 第三节
const qam0 = simulateAwgn({ order: 16, snrDb: 0, symbolCount: 20000, seed: SEED });

// 16QAM 0–20 dB 扫描（preview 第六节与曲线截图）
const berSweep = timed(
  () => sweepBer({ order: 16, fromDb: 0, toDb: 20, stepDb: 1, symbolCount: 20000, seed: SEED }),
  1,
);
const berPoint = (snrDb) => berSweep.value.find((p) => p.snrDb === snrDb);

// 卷积码 0–10 dB 三条线（4 dB 的 203 / 11）
const convSweep = timed(
  () => sweepConv({ fromDb: 0, toDb: 10, stepDb: 1, bits: 20000, seed: SEED }),
  1,
);
const conv4 = convSweep.value.find((p) => p.ebN0 === 4);

// 自由距离与纠错能力
const dFree = freeDistance();
const capability = correctionCapability(dFree.distance);

// 单次 20,000 符号仿真（预热一次再取中位数）
simulateAwgn({ order: 16, snrDb: 12, symbolCount: 20000, seed: SEED });
const singleSim = timed(() => simulateAwgn({ order: 16, snrDb: 12, symbolCount: 20000, seed: SEED }), 5);

// OFDM 200 符号、CP 16、延时 9（§2.6 的 0.0% / 22.9% 与 §2.4 的耗时）
const ofdm = timed(() => runOfdm({ cpLen: 16, delay: 9, symbolCount: 200, seed: SEED }), 3);

// ── 3. 断言清单 ────────────────────────────────────────────────────────────
const rules = [];
const add = (file, label, pattern, expected, tol) => {
  rules.push({ file, label, pattern, expected, tol });
};

const p12 = (order) => pageStats.get(order);

// 测试条数
add('README.md', '单测条数', /(\d+) 条单测/, [testCount], [EXACT]);
add('README.md', 'npm test 条数', /`npm test`（(\d+) 条）/, [testCount], [EXACT]);
add('README.md', '当前用例数', /当前 (\d+) 条用例/, [testCount], [EXACT]);
add('docs/preview.md', '测试条数', /测试 (\d+) 条，全部用 Node/, [testCount], [EXACT]);
add('docs/tech-report.md', '测试文件数与条数', /(\d+) 个文件、`npm test` 报 (\d+) 条/, [testFileCount, testCount], [EXACT, EXACT]);
add('docs/tech-report.md', '可复现表的用例数', /\| `npm test` \| [\d.]+ s \| (\d+) 条用例 \|/, [testCount], [EXACT]);
add('docs/tech-report.md', 'npm test 条数（3.3）', /`npm test` 会告诉你 (\d+) 条过没过/, [testCount], [EXACT]);
add('docs/tech-report.md', 'lint 段里的用例数', /真正的逻辑靠 (\d+) 条测试/, [testCount], [EXACT]);

// 16QAM 0 dB / 12 dB 的实测点（preview 第三、四节）
add(
  'docs/preview.md',
  '16QAM 0 dB 误码率',
  /0 dB 时误码率 ([\d.e+-]+)，旁注写着错 ([\d,]+) 个比特，共 ([\d,]+) 个比特/,
  [qam0.ber, qam0.bitErrors, qam0.bitCount],
  [PRINTED, EXACT, EXACT],
);
add(
  'docs/preview.md',
  '16QAM 12 dB 的读数',
  /不是孤零零一个 ([\d.e+-]+)，而是 ([\d,]+) \/ ([\d,]+)/,
  [berPoint(12).ber, berPoint(12).bitErrors, berPoint(12).bitCount],
  [PRINTED, EXACT, EXACT],
);
add('docs/preview.md', '20 dB 零错', /「这次没出错，(\d+) \/ ([\d,]+)」/, [berPoint(20).bitErrors, berPoint(20).bitCount], [EXACT, EXACT]);
add('docs/preview.md', '样本分辨率', /最小误码率就是 (\d+)\/([\d,]+)/, [1, berPoint(12).bitCount], [EXACT, EXACT]);

// 四档的实测 / 理论 / EVM（tech-report 2.3 的表）
for (const order of QAM_ORDERS) {
  const label = { 2: 'BPSK', 4: 'QPSK', 16: '16QAM', 64: '64QAM' }[order];
  const stat = p12(order);
  const row = new RegExp(
    `^\\| ${label} \\| ([\\d,]+) \\| ([\\d,]+) \\| ([\\d,]+) \\| ([\\d.e+-]+) \\| ([\\d.e+-]+) \\| ([\\d.]+)% \\|$`,
  );
  add(`docs/tech-report.md`, `${label} 12 dB 的一行`, row, [
    stat.symbolCount,
    stat.bitCount,
    stat.bitErrors,
    stat.ber,
    theoryBer(order, 12),
    stat.evmPercent,
  ], [EXACT, EXACT, EXACT, PRINTED, PRINTED, EVM]);
}

// preview 第七节的 64QAM 读数
add(
  'docs/preview.md',
  '64QAM 12 dB 的读数',
  /三个读数来自 ([\d,]+) 个符号 \/ ([\d,]+) 个比特，EVM 仍是 ([\d.]+)%/,
  [p12(64).symbolCount, p12(64).bitCount, p12(64).evmPercent],
  [EXACT, EXACT, EVM],
);

// 卷积码
add(
  'docs/preview.md',
  '卷积码 11 点与 4 dB',
  /(\d+) 个信噪比点、每点 ([\d,]+) 个比特、同一种子，4 dB 时硬判决错 (\d+) 个比特、软判决错 (\d+) 个/,
  [convSweep.value.length, conv4.bits, conv4.hardErrors, conv4.softErrors],
  [EXACT, EXACT, EXACT, EXACT],
);
add('docs/preview.md', '自由距离', /dfree = (\d+) 是程序/, [dFree.distance], [EXACT]);
add('docs/preview.md', '纠错能力', /⌊\((\d+)−1\)\/2⌋ = (\d+)/, [dFree.distance, capability], [EXACT, EXACT]);

// 子载波数
add('README.md', 'OFDM 子载波数', /(\d+) 个子载波/, [SUBCARRIERS], [EXACT]);
add('docs/preview.md', 'OFDM 子载波数', /(\d+) 个子载波/, [SUBCARRIERS], [EXACT]);
add('docs/tech-report.md', 'OFDM 子载波数', /(\d+) 点子载波/, [SUBCARRIERS], [EXACT]);

// 耗时（宽带：墙钟随机器变，只卡量级）
add('docs/preview.md', 'QAM 21 点扫描耗时', /21 点 × ([\d,]+) 符号的曲线本机约 (\d+) ms/, [20000, berSweep.ms], [EXACT, TIMING]);
add('docs/preview.md', '卷积 11 点耗时', /卷积码 (\d+) 点 × ([\d,]+) 比特的三条线约 (\d+) ms/, [convSweep.value.length, 20000, convSweep.ms], [EXACT, EXACT, TIMING]);
add('docs/preview.md', '单次仿真耗时', /单次 ([\d,]+) 个符号的仿真约 ([\d.]+) ms/, [20000, singleSim.ms], [EXACT, TIMING]);
add('docs/tech-report.md', 'OFDM 整链耗时', /实测 ([\d.]+)–([\d.]+) ms/, [ofdm.ms, ofdm.ms], [TIMING, TIMING]);

// OFDM EVM
add(
  'docs/tech-report.md',
  'delay 9 的 EVM',
  /有 CP 侧立刻变成 ([\d.]+)%，无 CP 侧 ([\d.]+)%/,
  [ofdm.value.withCp.evmPercent, ofdm.value.noCp.evmPercent],
  [EVM, EVM],
);

// ── 4. 逐行比对 ────────────────────────────────────────────────────────────
const failures = [];
let checked = 0;
const perFile = new Map(FILES.map((f) => [f, 0]));

for (const rule of rules) {
  const file = join(ROOT, rule.file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let matches = 0;

  lines.forEach((line, index) => {
    const m = line.match(rule.pattern);
    if (!m) return;
    matches += 1;
    for (let i = 0; i < rule.expected.length; i += 1) {
      const raw = m[i + 1];
      const written = Number(String(raw).replace(/,/g, ''));
      const actual = rule.expected[i];
      const tol = Array.isArray(rule.tol) ? rule.tol[i] : rule.tol;
      checked += 1;
      const pass = tol.band
        ? written >= actual / tol.band && written <= actual * tol.band
        : Math.abs(written - actual) <= Math.max(tol.abs ?? 0, (tol.rel ?? 0) * Math.abs(actual));
      if (!pass) {
        failures.push({
          file: rule.file,
          line: index + 1,
          label: rule.label,
          written: raw,
          actual,
          hint: tol.band ? `（耗时按 ${tol.band} 倍宽带比对）` : '',
        });
      }
    }
  });

  if (matches === 0) {
    failures.push({
      file: rule.file,
      line: 0,
      label: rule.label,
      missing: true,
      hint: '这句断言在文档里找不到，文档句子被改写过——补回断言或改 scripts/check-docs.mjs',
    });
  }
  perFile.set(rule.file, perFile.get(rule.file) + matches);
}

// 结构性断言：轮次表与 tag 列表一一对应；正文提到的 tag 必须真实存在。
// 这两条不涉及数字，但同样会过期（表只写到 R10、正文写了一个不存在的 tag）。
let structuralLine = '';
const tagRun = spawnSync('git', ['tag', '-l'], { cwd: ROOT, encoding: 'utf8' });
const tagList = tagRun.status === 0 ? tagRun.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];

if (tagRun.status !== 0) {
  failures.push({
    file: '(git)',
    line: 0,
    label: 'git tag -l',
    missing: true,
    hint: '读不到 tag 列表：check-docs 要在 git 仓库里跑（CI 里 checkout 之后就满足）',
  });
} else {
  const reportLines = readFileSync(join(ROOT, 'docs/tech-report.md'), 'utf8').split('\n');
  const headAt = reportLines.findIndex((line) => /^### .*轮次与 tag 对照/.test(line));
  const tableAt = reportLines.findIndex((line, i) => i > headAt && /^\|\s*轮次\s*\|/.test(line));
  const tableLine = tableAt >= 0 ? tableAt + 1 : headAt + 1;
  const rows = [];
  if (headAt >= 0) {
    for (let i = headAt + 1; i < reportLines.length && !/^### /.test(reportLines[i]); i += 1) {
      const m = reportLines[i].match(/^\|\s*(R\d+[a-z]?)\s*\|\s*(R\d+[a-z]?)\s*\|/);
      if (m) rows.push({ line: i + 1, round: m[1], tag: m[2] });
    }
  }

  const tagSet = new Set(tagList);
  const rowTags = new Set(rows.map((row) => row.tag));

  if (headAt < 0) {
    failures.push({
      file: 'docs/tech-report.md',
      line: 0,
      label: '轮次与 tag 对照',
      missing: true,
      hint: '找不到「### … 轮次与 tag 对照」小节，表被改名或删掉了',
    });
  } else {
    if (rows.length !== tagList.length) {
      failures.push({
        file: 'docs/tech-report.md',
        line: tableLine,
        label: '轮次表行数与 git tag -l 不一致',
        written: `表里 ${rows.length} 行`,
        actual: `git tag -l 有 ${tagList.length} 个`,
      });
    }
    for (const tag of tagList) {
      if (!rowTags.has(tag)) {
        failures.push({
          file: 'docs/tech-report.md',
          line: tableLine,
          label: `轮次表缺 ${tag} 这一行`,
          written: '缺',
          actual: `git tag -l 有 ${tag}`,
        });
      }
    }
    for (const row of rows) {
      if (!tagSet.has(row.tag)) {
        failures.push({
          file: 'docs/tech-report.md',
          line: row.line,
          label: `轮次表写了 ${row.tag}，但它不是仓库里的 tag`,
          written: row.tag,
          actual: 'git tag -l 里没有',
        });
      }
    }
  }

  for (const file of FILES) {
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(?<![\w])R\d+[a-z]?(?![\w])/g)) {
        if (tagSet.has(m[0])) continue;
        failures.push({
          file,
          line: i + 1,
          label: `正文提到 ${m[0]}，但 git tag -l 里没有这个 tag`,
          written: m[0],
          actual: 'git tag -l 里没有',
        });
      }
    });
  }

  structuralLine = `  轮次表 ${rows.length} 行，git tag -l ${tagList.length} 个；正文里的 tag 名已逐个核对。`;
}

console.log(`check-docs：用 src/core 重算文档数字（种子 ${SEED}）`);
console.log(
  `  测试 ${testCount} 条 / ${testFileCount} 个文件；页面默认 ${PAGE_BITS} 比特，16QAM 12 dB 为 ${p12(16).symbolCount} 个符号、${p12(16).bitCount} 个比特`,
);
console.log(structuralLine);
console.log(
  `  本机耗时：单次 20,000 符号 ${singleSim.ms.toFixed(1)} ms；16QAM 21 点 ${berSweep.ms.toFixed(1)} ms；卷积 11 点 ${convSweep.ms.toFixed(1)} ms；OFDM 200 符号 ${ofdm.ms.toFixed(1)} ms`,
);

if (failures.length > 0) {
  for (const f of failures.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))) {
    if (f.missing) {
      console.error(`\n${f.file}  ${f.label}`);
      console.error('  文档：这一条断言找不到。');
      console.error(`  ${f.hint}`);
      continue;
    }
    console.error(`\n${f.file}:${f.line}  ${f.label}`);
    console.error(`  文档：${f.written}`);
    console.error(`  实际：${formatValue(f.actual)}${f.hint ?? ''}`);
  }
  console.error(`\n共 ${failures.length} 处不符，check:docs 未通过。`);
  process.exit(1);
}

const summary = [...perFile.entries()].map(([f, n]) => `${f} ${n}`).join('、');
console.log(`  通过 ${checked} 条断言（${summary}），0 处不符。`);

function formatValue(value) {
  if (typeof value === 'string') return value;
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  if (Math.abs(value) >= 1e-3 && Math.abs(value) < 1e5) return String(Number(value.toPrecision(6)));
  return value.toExponential(3);
}
