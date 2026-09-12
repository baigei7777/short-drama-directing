#!/usr/bin/env node
/**
 * gen-voice.js —— 生成全剧配音资产清单（换新剧本时跑一次）
 *
 * 用法：node gen-voice.js <结构化剧本.json> [输出.md]
 *
 * 产出：每集的台词条数 / OS 条数 / 台词字数 / 估算时长 / 主要说话人，
 *       以及每集的全部说话人清单（配音拆轨时按这个查）。
 *
 * ★ 时长全部是**按字数估算**（中文常态 4–5 字/秒，取 4.5）。
 *   配音到位后必须用实际音频替换。交付时也要告诉用户这是估值。
 */
const fs = require('fs');

const args = process.argv.slice(2);
if (!args.length) { console.log('用法: node gen-voice.js <结构化剧本.json> [输出.md]'); process.exit(1); }
const [jsonPath, outPath] = args;

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const eps = data.episodes.filter((e) => e.ep > 0);
const allLines = (e) => {
  const out = e.lines.slice();
  for (const s of e.scenes) for (const l of s.lines) out.push(l);
  return out;
};
const RATE = 4.5; // 字/秒

const rows = [];
let totalChars = 0, totalOs = 0;
for (const e of eps) {
  const byChar = new Map();
  let osChars = 0, diaChars = 0, diaCount = 0, osCount = 0;
  for (const l of allLines(e)) {
    if (l.type !== 'dialogue') continue;
    const n = (l.text || '').length;
    byChar.set(l.who, (byChar.get(l.who) || 0) + n);
    if (l.os) { osChars += n; osCount++; } else { diaChars += n; diaCount++; }
    totalChars += n;
  }
  totalOs += osCount;
  const speakers = [...byChar.entries()].sort((a, b) => b[1] - a[1]);
  rows.push({
    ep: e.ep, scenes: e.scenes.length, diaCount, osCount,
    chars: diaChars + osChars, est: (diaChars + osChars) / RATE,
    top: speakers.slice(0, 4).map(([n, c]) => `${n}(${c})`).join('、'),
    all: speakers.map(([n, c]) => `${n}(${c})`).join('、'),
  });
}
const bar = (v, max, w) => '█'.repeat(Math.max(1, Math.round((v / max) * w)));

const L = [];
L.push('# 全剧配音资产清单');
L.push('');
L.push(`> 本表是**时长估算的来源**。剧本未附配音音频时，所有数值为**按字数估算**（中文常态 ${RATE} 字/秒）。`);
L.push('> 每集分镜表里的对应时长一律标 `待核`。**配音到位后请以实际音频替换。**');
L.push('');
L.push(`- 集数：${eps.length}`);
L.push(`- 台词总字数：${totalChars}`);
L.push(`- 全剧台词估算总时长：约 ${Math.round(totalChars / RATE)} 秒 ≈ ${(totalChars / RATE / 60).toFixed(1)} 分钟`);
L.push(`- 每集平均台词字数：${Math.round(totalChars / eps.length)}　→ 约 ${(totalChars / eps.length / RATE).toFixed(0)} 秒/集`);
L.push(`- OS（内心独白）条数合计：${totalOs}（OS 需单独录，音色处理要与现场台词区分）`);
L.push('');
L.push('## 命名规范');
L.push('');
L.push('```');
L.push('A-<角色缩写>-E<集号>-<序号>      例：A-JJ-E01-01');
L.push('```');
L.push('同一句包含多角色时按角色拆成多条音频，**一条音频只对应一个角色**（便于按角色绑音色）。');
L.push('');
L.push('## 每集配音量');
L.push('');
L.push('| 集 | 场数 | 台词条数 | OS条数 | 台词字数 | 估算时长 | 时长条 | 主要说话人（字数） |');
L.push('|---:|---:|---:|---:|---:|---:|---|---|');
const maxEst = Math.max(...rows.map((r) => r.est), 1);
for (const r of rows) {
  L.push(`| E${r.ep} | ${r.scenes} | ${r.diaCount} | ${r.osCount} | ${r.chars} | ${r.est.toFixed(1)}s | ${bar(r.est, maxEst, 24)} | ${r.top} |`);
}
L.push('');
L.push('## 按集查阅：每一集的全部说话人');
L.push('');
for (const r of rows) L.push(`- **E${String(r.ep).padStart(2, '0')}**（${r.chars}字 / 约${r.est.toFixed(0)}s）：${r.all}`);
L.push('');
L.push('## 分集配音录制建议');
L.push('');
L.push('1. **一个生成单元的音频建议 5–10 秒**；超过 10 秒的段落按气口拆成多段，并在分镜里拆成多个镜头。');
L.push('2. **OS 单独一轨**，做近距离耳语处理，与对白区分开。');
L.push('3. **集尾钩子单独检查**：剧本标了卡点的集，最后一句台词情绪要给足。');
L.push('4. 拆音时**以气口为准**，不要按标点硬切，否则口型会对不上。');
L.push('');

const out = L.join('\n');
if (outPath) { fs.writeFileSync(outPath, out, 'utf8'); console.log('✓ 已写入 ' + outPath); }
else process.stdout.write(out);
console.log(`  ${eps.length} 集／台词总字 ${totalChars}／估算总时长 ${Math.round(totalChars / RATE)} 秒`);
