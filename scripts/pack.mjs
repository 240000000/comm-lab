// 打作品包：一条命令产出评委能直接解压看的 zip。
//
// 结构沿用旧包：一个 comm-lab/ 源码目录 + 包根三个文件（两份 PDF 与 提交说明.txt）。
// 源码用 git archive 打，所以只含已跟踪文件，.git / node_modules / dist 天然不在里面；
// 两份 PDF 和 提交说明.txt 用系统 python 的 zipfile 追加到包根（本机没有 zip 命令）。
//
// 用法：
//   node scripts/pack.mjs                       # 用 git describe 得到的最新 tag
//   node scripts/pack.mjs --tag R50             # 指定 tag
//   node scripts/pack.mjs --out D:\tmp\a-test.zip
// 打完会解压到临时目录自查四件事，任一条不过就退出码 1。

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 包根三样东西的默认位置；本机流水线就在这两个目录之间。
const DEFAULT_REPORT = 'E:/work/pdf/AI/comm-lab-技术报告.pdf';
const DEFAULT_INTRO = 'E:/work/pdf/AI/comm-lab-作品介绍.pdf';

const PLACEHOLDERS = [
    '{{TAG}}',
    '{{TESTS}}',
    '{{ASSERTIONS}}',
    '{{PAGES_REPORT}}',
    '{{PAGES_INTRO}}',
    '{{FILES}}',
];

function parseArgs(argv) {
    const opts = {
        tag: '',
        out: '',
        report: DEFAULT_REPORT,
        intro: DEFAULT_INTRO,
        note: join(ROOT, 'docs', '提交说明.md'),
        keep: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--tag') {
            opts.tag = value;
            i += 1;
        } else if (key === '--out') {
            opts.out = value;
            i += 1;
        } else if (key === '--report') {
            opts.report = value;
            i += 1;
        } else if (key === '--intro') {
            opts.intro = value;
            i += 1;
        } else if (key === '--note') {
            opts.note = value;
            i += 1;
        } else if (key === '--keep') {
            opts.keep = true;
        } else {
            throw new Error(`不认识的参数：${key}`);
        }
    }
    return opts;
}

function git(args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// 系统 python 只用来做 zip 的追加与解压：Node 内置模块没有 zip 写入能力，
// 本机也没有 zip/unzip 命令，而比赛要求不装第三方依赖。
function python(code, args) {
    const dir = mkdtempSync(join(tmpdir(), 'comm-lab-py-'));
    const file = join(dir, 'task.py');
    writeFileSync(file, code, 'utf8');
    try {
        return execFileSync('python', ['-X', 'utf8', file, ...args], { cwd: ROOT, encoding: 'utf8' }).trim();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function pdfPages(file) {
    const code = [
        'import sys',
        'from pypdf import PdfReader',
        'print(len(PdfReader(sys.argv[1]).pages))',
    ].join('\n');
    return Number(python(code, [file]));
}

function appendToRoot(zipPath, entries) {
    const code = [
        'import os, sys, zipfile',
        'zpath = sys.argv[1]',
        'pairs = [a.split("=", 1) for a in sys.argv[2:]]',
        'with zipfile.ZipFile(zpath, "a", zipfile.ZIP_DEFLATED) as z:',
        '    for arcname, path in pairs:',
        '        z.write(path, arcname=arcname)',
    ].join('\n');
    python(code, [zipPath, ...entries.map(([arcname, path]) => `${arcname}=${path}`)]);
}

function listZip(zipPath) {
    const code = [
        'import json, sys, zipfile',
        'with zipfile.ZipFile(sys.argv[1]) as z:',
        '    infos = z.infolist()',
        '    files = [i.filename for i in infos if not i.is_dir()]',
        '    size = sum(i.file_size for i in infos)',
        'print(json.dumps({"entries": len(infos), "files": len(files), "unpacked": size, "names": files}, ensure_ascii=False))',
    ].join('\n');
    return JSON.parse(python(code, [zipPath]));
}

function extractZip(zipPath, into) {
    const code = [
        'import sys, zipfile',
        'zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
    ].join('\n');
    python(code, [zipPath, into]);
}

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

// Windows 上 npm 是 npm.cmd，execFileSync 直接调 'npm' 会 ENOENT。
function countTests() {
    const out = execSync('npm test', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const m = out.match(/\btests (\d+)/);
    if (!m) throw new Error('npm test 的输出里找不到测试条数');
    return Number(m[1]);
}

function countAssertions() {
    const out = execSync('npm run check:docs', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const m = out.match(/通过 (\d+) 条断言/);
    if (!m) throw new Error('check:docs 的输出里找不到断言条数');
    return Number(m[1]);
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const tag = opts.tag || git(['describe', '--tags', '--abbrev=0']);
    if (!/^R\d+[a-z]?$/.test(tag)) throw new Error(`tag 名不像 R 加数字：${tag}`);
    git(['rev-parse', '--verify', `refs/tags/${tag}`]);

    for (const file of [opts.report, opts.intro]) {
        if (!existsSync(file)) throw new Error(`找不到要放进包根的 PDF：${file}`);
    }

    const work = mkdtempSync(join(tmpdir(), 'comm-lab-pack-'));
    const outZip = opts.out
        ? resolve(opts.out)
        : join(work, `comm-lab-作品包-${tag}-test.zip`);

    // 1. 源码：git archive 只打已跟踪文件，.git / node_modules / dist 不会进来。
    git(['archive', '--format=zip', '--prefix=comm-lab/', tag, '-o', outZip]);

    // 2. 数：测试条数、断言条数、两个 PDF 的页数，全当场跑，不抄。
    const tests = countTests();
    const assertions = countAssertions();
    const pagesReport = pdfPages(opts.report);
    const pagesIntro = pdfPages(opts.intro);
    const sourceFiles = Number(git(['ls-tree', '-r', '--name-only', tag]).split(/\r?\n/).filter(Boolean).length);
    const totalFiles = sourceFiles + 3; // 两份 PDF + 提交说明.txt

    const values = {
        '{{TAG}}': tag,
        '{{TESTS}}': String(tests),
        '{{ASSERTIONS}}': String(assertions),
        '{{PAGES_REPORT}}': String(pagesReport),
        '{{PAGES_INTRO}}': String(pagesIntro),
        '{{FILES}}': String(totalFiles),
    };

    // 3. 提交说明：把占位符换成当场算出来的值，写到包根。
    let note = readFileSync(opts.note, 'utf8');
    const missing = PLACEHOLDERS.filter((p) => !note.includes(p));
    if (missing.length) throw new Error(`docs/提交说明.md 少了占位符：${missing.join('、')}`);
    for (const [key, value] of Object.entries(values)) note = note.split(key).join(value);
    if (note.includes('{{')) throw new Error('替换后仍残留 {{ ，说明有占位符写错了');
    const noteFile = join(work, '提交说明.txt');
    writeFileSync(noteFile, note, 'utf8');

    // 4. 把包根三样东西追加进 zip（注意是包根，不是 comm-lab/ 里面）。
    appendToRoot(outZip, [
        [basename(opts.report), opts.report],
        [basename(opts.intro), opts.intro],
        ['提交说明.txt', noteFile],
    ]);
    // 自检：解压到临时目录，四条硬断言。
    const unzip = join(work, 'unzip');
    extractZip(outZip, unzip);
    const files = walk(unzip);
    const rel = files.map((f) => f.slice(unzip.length + 1).split(sep).join('/'));
    const problems = [];
    const BANNED = ['.git', 'node_modules', 'dist'];
    for (const name of rel) {
        for (const seg of name.split('/')) {
            if (BANNED.includes(seg)) problems.push(`包里不该出现 ${seg}/：${name}`);
        }
    }
    for (const name of [basename(opts.report), basename(opts.intro), '提交说明.txt']) {
        if (!rel.includes(name)) problems.push(`包根缺 ${name}`);
    }
    const noteInZip = join(unzip, '提交说明.txt');
    if (existsSync(noteInZip)) {
        const text = readFileSync(noteInZip, 'utf8');
        if (text.includes('{{')) problems.push('提交说明.txt 里还有 {{ 残留');
        const pairs = [
            [pagesReport, `${pagesReport} 页`],
            [pagesIntro, `${pagesIntro} 页`],
        ];
        for (const [pages, needle] of pairs) {
            if (!text.includes(needle)) problems.push(`提交说明.txt 里没有「${needle}」（实际 ${pages} 页）`);
        }
    }

    const stat = statSync(outZip);
    const sha = createHash('sha256').update(readFileSync(outZip)).digest('hex').slice(0, 16);
    const listed = listZip(outZip);

    console.log(`打包完成：${outZip}`);
    console.log(`  tag ${tag}｜测试 ${tests} 条｜断言 ${assertions} 条｜报告 ${pagesReport} 页｜介绍 ${pagesIntro} 页`);
    console.log(`  条目 ${listed.entries} 个（文件 ${listed.files} 个，目录 ${listed.entries - listed.files} 个）｜zip ${stat.size} 字节｜解压 ${listed.unpacked} 字节｜sha256 前 16 位 ${sha}`);

    if (problems.length) {
        console.error('自检未通过：');
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
    }
    console.log('  自检通过：无 .git / node_modules / dist；包根三样齐全；说明里无占位符残留；页数与说明一致。');

    if (!opts.keep && !opts.out) console.log('（临时目录会在退出时删除；要留档就加 --out 指定路径）');
}

main();