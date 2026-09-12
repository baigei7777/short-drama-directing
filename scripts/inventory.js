#!/usr/bin/env node
/**
 * inventory.js —— 从结构化剧本抽取资产清单草案（换新剧本时跑一次）
 *
 * 用法：node inventory.js <结构化剧本.json> [输出.md]
 *
 * 产出：人物表（台词数 / 首次出现 / 出现集区间）、地点表（含出现集区间）、
 *       特写道具候选、集尾标记所在集。
 * 注意：这是**草案**。人物分层、场景归并、道具取舍要人工判断，
 *       不要让脚本替你决定哪些角色需要定妆图。
 */
const fs = require('fs');

const args = process.argv.slice(2);
if (!args.length) { console.log('用法: node inventory.js <结构化剧本.json> [输出.md]'); process.exit(1); }
const [jsonPath, outPath] = args;

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const eps = data.episodes.filter((e) => e.ep > 0);
const allLines = (e) => {
  const out = e.lines.slice();
  for (const s of e.scenes) for (const l of s.lines) out.push(Object.assign({ sceneNo: s.sceneNo }, l));
  return out;
};
function ranges(nums) {
  const a = [...new Set(nums)].sort((x, y) => x - y);
  if (!a.length) return '';
  const out = []; let s = a[0], p = a[0];
  for (let i = 1; i <= a.length; i++) {
    if (a[i] === p + 1) { p = a[i]; continue; }
    out.push(s === p ? String(s) : `${s}-${p}`); s = p = a[i];
  }
  return out.join(', ');
}

const persons = new Map(), places = new Map();
for (const e of eps) {
  for (const l of allLines(e)) {
    if (l.type !== 'dialogue' || !l.who) continue;
    if (!persons.has(l.who)) persons.set(l.who, { count: 0, eps: [] });
    const p = persons.get(l.who); p.count++; p.eps.push(e.ep);
  }
  for (const s of e.scenes) {
    if (!places.has(s.place)) places.set(s.place, { eps: [], times: new Set() });
    const pl = places.get(s.place); pl.eps.push(e.ep); if (s.time) pl.times.add(s.time);
  }
}
const props = [];
for (const e of eps) for (const l of allLines(e)) {
  if (l.type !== 'action') continue;
  const re = /【特写】([^。！？\n]{0,40})/g; let m;
  while ((m = re.exec(l.text))) props.push({ ep: e.ep, text: m[1].trim() });
}
const marks = new Map();
for (const e of eps) for (const l of allLines(e)) {
  if (l.type !== 'mark') continue;
  if (!marks.has(l.text)) marks.set(l.text, []);
  marks.get(l.text).push(e.ep);
}

const L = [];
L.push('# 资产清单草案（自动抽取，**待人工归并**）');
L.push('');
L.push(`来源：\`${jsonPath}\`　集数：${eps.length}`);
L.push('');
L.push('## 一、人物（按台词条数）');
L.push('');
L.push('| 人物 | 台词数 | 首次出现 | 出现集数 |');
L.push('|---|---:|---:|---|');
for (const [n, p] of [...persons.entries()].sort((a, b) => b[1].count - a[1].count)) {
  L.push(`| ${n} | ${p.count} | E${Math.min(...p.eps)} | ${ranges(p.eps)} |`);
}
L.push('');
L.push('> ⚠️ **不要按台词数决定谁需要定妆图。** 台词少的角色可能是关键人物——本项目里 E01 的纪淮只有 1 句台词，但他是开场就在场的元凶。');
L.push('');
L.push('## 二、地点（原始写法，按出现集数）');
L.push('');
L.push('| 地点（原始） | 场次数 | 出现集数 | 时间/备注 |');
L.push('|---|---:|---|---|');
for (const [n, p] of [...places.entries()].sort((a, b) => b[1].eps.length - a[1].eps.length)) {
  L.push(`| ${n} | ${p.eps.length} | ${ranges(p.eps)} | ${[...p.times].join('、')} |`);
}
L.push('');
L.push('> 原始写法通常很碎（几十上百种），需要归并成真正要出图的场景。归并规则按项目定，脚本不做。');
L.push('');
L.push('## 三、道具候选（从【特写】行抽取）');
L.push('');
if (props.length) for (const p of props) L.push(`- E${p.ep}：${p.text}`);
else L.push('（剧本里没有【特写】标记——道具表需要人工从动作行里挑）');
L.push('');
L.push('## 四、标记行（闪回 / 字幕 / 卡点等）');
L.push('');
for (const [text, eps2] of [...marks.entries()].sort((a, b) => b[1].length - a[1].length)) {
  L.push(`- \`${text}\` —— ${eps2.length} 处（${ranges(eps2)}）`);
}
L.push('');

const out = L.join('\n');
if (outPath) { fs.writeFileSync(outPath, out, 'utf8'); console.log('✓ 已写入 ' + outPath); }
else process.stdout.write(out);
console.log(`  人物 ${persons.size} 个／地点写法 ${places.size} 种／道具候选 ${props.length} 条／标记 ${marks.size} 种`);
