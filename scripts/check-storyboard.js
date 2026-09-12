#!/usr/bin/env node
/**
 * check-storyboard.js —— 分镜表 / 提示词 格式一致性校验（第二道门）
 *
 * 用法：
 *   node check-storyboard.js <分镜表.md>            # 只校验分镜表
 *   node check-storyboard.js <分镜表.md> <提示词.txt>  # 同时校验提示词并交叉比对
 *   node check-storyboard.js <目录>                 # 自动扫描目录下的 E*-分镜表.md 与 E*-prompts.txt
 *
 * 校验项：
 *   1. 图N / 音频N 是否都在该单元的「上传顺序」范围内
 *   2. 时间轴是否连续（首尾相接，无空洞无重叠）
 *   3. 单元总长是否 ≤30 秒
 *   4. 含 2 镜以上的单元是否 ≥10 秒（官方：多镜低于约 10s 会饿死节奏）
 *   5. 单镜时长是否在 1.0–6.5 秒
 *   6. 每镜是否有非空的「拍摄备注」
 *   7. 列数是否为 13
 *   8. 分镜表 ↔ 提示词 的图片/音频数量是否一致
 *   9. 提示词里是否残留画面文字指令
 *
 * ★ 每次运行都会打印「被检查了多少项」。如果计数是 0，说明校验器失效了，不是数据干净。
 */
const fs = require('fs');
const path = require('path');

const COLS = 13;            // 分镜表列数
const MIN_SHOT = 1.0;       // 单镜下限（秒）
const MAX_SHOT = 6.5;       // 单镜上限（秒）
const MAX_UNIT = 30;        // 单元上限（秒）
const MIN_MULTISHOT = 10;   // 含 2 镜以上的单元下限（秒）

function parseOrder(text) {
  const out = [];
  const re = /(\d+)\)\s*(图|音频)-([^\s　]+)/g;
  let m;
  while ((m = re.exec(text))) out.push({ idx: Number(m[1]), type: m[2], name: m[3] });
  return out;
}

function audit(file, isPrompts) {
  const text = fs.readFileSync(file, 'utf8');
  const splitter = isPrompts ? /^# 单元 /m : /^## 单元 /m;
  const blocks = text.split(splitter).slice(1);
  const problems = [];
  const summary = [];

  for (const b of blocks) {
    const idm = b.match(/^(U[\d-]+)/);
    if (!idm) continue;
    const unit = idm[1];

    const orderBlock = isPrompts
      ? ((b.match(/# 上传顺序：([\s\S]*?)\n# 素材绑定/) || [, ''])[1].replace(/\n#\s*/g, ' '))
      : ((b.match(/\*\*上传顺序\*\*：(.+)/) || [, ''])[1]);
    const order = parseOrder(orderBlock);
    const imgCount = order.filter((o) => o.type === '图').length;
    const audioCount = order.filter((o) => o.type === '音频').length;

    const body = isPrompts ? b : b.split('\n').filter((l) => l.trim().startsWith('| U')).join('\n');

    const usedImg = new Set(), usedAudio = new Set();
    let m;
    const reI = /图\s?(\d+)/g;
    while ((m = reI.exec(body))) usedImg.add(Number(m[1]));
    const reA = /音频\s?(\d+)/g;
    while ((m = reA.exec(body))) usedAudio.add(Number(m[1]));

    const badImg = [...usedImg].filter((n) => n > imgCount).sort((a, b) => a - b);
    const badAudio = [...usedAudio].filter((n) => n > audioCount).sort((a, b) => a - b);
    const unusedImg = [];
    for (let i = 1; i <= imgCount; i++) if (!usedImg.has(i)) unusedImg.push(i);

    let times = [], gap = null, total = 0, badDur = [], shots = 0, noNote = [], badCols = [], noTime = 0;
    if (!isPrompts) {
      const rows = b.split('\n').filter((l) => l.trim().startsWith('| U'));
      shots = rows.length;
      for (const row of rows) {
        const c = row.split('|');
        // 支持整数与小数：1.5-4.5s
        const mm = (c[3] || '').trim().match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)s$/);
        if (mm) times.push([Number(mm[1]), Number(mm[2])]);
        else noTime++;
        if (c.length !== COLS + 2) badCols.push((c[2] || '').trim() + `(${c.length - 2}列)`);
        if (!(c[COLS] || '').trim()) noNote.push((c[2] || '').trim());
      }
      for (let i = 1; i < times.length; i++) if (times[i][0] !== times[i - 1][1]) gap = `${times[i - 1][1]}s → ${times[i][0]}s`;
      total = times.length ? times[times.length - 1][1] : 0;
      for (const [a, z] of times) { const d = z - a; if (d < MIN_SHOT || d > MAX_SHOT) badDur.push(`${a}-${z}s(${d}s)`); }
    }

    summary.push({ unit, imgCount, audioCount, shots, total, gap, unusedImg, times });
    if (badImg.length) problems.push(`${unit}: 引用了 图${badImg.join(',图')}，但上传顺序只有 ${imgCount} 张图`);
    if (badAudio.length) problems.push(`${unit}: 引用了 音频${badAudio.join(',音频')}，但上传顺序只有 ${audioCount} 条音频`);
    if (gap) problems.push(`${unit}: 时间轴不连续 —— ${gap}`);
    if (!isPrompts && noTime) problems.push(`${unit}: 有 ${noTime} 镜的时间轴无法解析（格式应为 \`0-4s\` 或 \`1.5-4.5s\`）`);
    if (total > MAX_UNIT) problems.push(`${unit}: 总时长 ${total}s 超过 ${MAX_UNIT} 秒硬上限`);
    if (!isPrompts && shots >= 2 && total > 0 && total < MIN_MULTISHOT) {
      problems.push(`${unit}: 含 ${shots} 镜但总长只有 ${total}s，低于"多镜单元 ≥${MIN_MULTISHOT}s"的下限`);
    }
    if (badDur.length) problems.push(`${unit}: 镜头时长越界(应 ${MIN_SHOT}–${MAX_SHOT}s) —— ${badDur.join('、')}`);
    if (noNote.length) problems.push(`${unit}: 以下镜头缺拍摄备注 —— ${noNote.join('、')}`);
    if (badCols.length) problems.push(`${unit}: 列数不是 ${COLS} —— ${badCols.join('、')}`);
  }
  return { summary, problems };
}

// ---------- 入口 ----------
const args = process.argv.slice(2);
if (!args.length) {
  console.log('用法: node check-storyboard.js <分镜表.md 或 目录> [提示词.txt]');
  process.exit(1);
}

const target = args[0];
const pairs = [];
if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
  const files = fs.readdirSync(target).filter((f) => /^E\d+-分镜表\.md$/.test(f)).sort();
  const prDir = fs.existsSync(path.join(target, '..', '02-提示词'))
    ? path.join(target, '..', '02-提示词')
    : target;
  for (const f of files) {
    const ep = f.slice(0, 3);
    const pr = path.join(prDir, `${ep}-prompts.txt`);
    pairs.push([path.join(target, f), fs.existsSync(pr) ? pr : null]);
  }
  if (!pairs.length) { console.log(`✗ 在 ${target} 里没找到 E*-分镜表.md —— 检查路径`); process.exit(1); }
} else {
  pairs.push([target, args[1] || null]);
}

let grandUnits = 0, grandShots = 0, grandSec = 0, grandTimed = 0;
const allProblems = [];

for (const [sb, pr] of pairs) {
  const label = path.basename(sb).replace('-分镜表.md', '');
  const r1 = audit(sb, false);
  console.log(`\n=== ${label} ｜ ${path.basename(sb)} ===`);
  console.log('单元       图片  音频  镜头  总时长  时间轴');
  for (const s of r1.summary) {
    console.log(`  ${s.unit.padEnd(9)} ${String(s.imgCount).padStart(2)}   ${String(s.audioCount).padStart(2)}   ${String(s.shots).padStart(3)}   ${String(s.total).padStart(4)}s   ${s.gap ? '断点 ' + s.gap : 'OK'}`);
  }
  const shots = r1.summary.reduce((a, s) => a + s.shots, 0);
  const timed = r1.summary.reduce((a, s) => a + s.times.length, 0);
  const sec = r1.summary.reduce((a, s) => a + s.total, 0);
  console.log(`  合计：${r1.summary.length} 单元 / ${shots} 镜 / ${sec} 秒`);
  grandUnits += r1.summary.length; grandShots += shots; grandSec += sec; grandTimed += timed;

  allProblems.push(...r1.problems.map((p) => `${label} ${p}`));

  if (pr) {
    const r2 = audit(pr, true);
    allProblems.push(...r2.problems.map((p) => `${label} ${p}`));
    const map2 = new Map(r2.summary.map((s) => [s.unit, s]));
    for (const s of r1.summary) {
      const t = map2.get(s.unit);
      if (!t) { allProblems.push(`${label} ${s.unit}: 提示词里缺失该单元`); continue; }
      if (t.imgCount !== s.imgCount || t.audioCount !== s.audioCount) {
        allProblems.push(`${label} ${s.unit}: 分镜表 ${s.imgCount}图/${s.audioCount}音频 ≠ 提示词 ${t.imgCount}图/${t.audioCount}音频`);
      }
    }
    fs.readFileSync(pr, 'utf8').split('\n').forEach((l, i) => {
      if (i < 16) return; // 跳过文件头的说明段
      if (/画面中显示|显示一行文字|显示文字|【字幕/.test(l)) {
        allProblems.push(`${label} 提示词第 ${i + 1} 行仍有画面文字指令：${l.trim().slice(0, 60)}`);
      }
    });
  }
}

console.log('\n=================== 检查计数（★ 若为 0 说明校验器失效，不是数据干净）===================');
console.log(`  集数文件：${pairs.length}　单元：${grandUnits}　镜头：${grandShots}　被解析的时间轴：${grandTimed}　总长：${grandSec} 秒`);
if (grandTimed === 0 && grandShots > 0) {
  console.log('  ⚠️⚠️ 镜头数 > 0 但被解析的时间轴为 0 —— 时间轴格式与校验器不匹配，所有时长校验都被跳过了！');
}

console.log('\n=================== 问题汇总 ===================');
if (!allProblems.length) console.log('  无。');
else allProblems.forEach((p) => console.log('  ✗ ' + p));
process.exit(allProblems.length ? 1 : 0);
