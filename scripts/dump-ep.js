#!/usr/bin/env node
/**
 * dump-ep.js —— 导出某一集的完整结构化内容 + 全剧关键词检索
 *
 * 用法：
 *   node dump-ep.js <结构化剧本.json> <集号>              # 打印该集全文（场次/台词/OS/动作/标记/统计）
 *   node dump-ep.js <结构化剧本.json> <集号> <关键词>      # 顺便在全剧检索这个词
 *   node dump-ep.js <结构化剧本.json> --search <关键词>    # 只做全剧检索
 *
 * ★ 这是每一集开工的第一步：先把它跑一遍，拿到这一集的完整场次、台词、动作与时长估算，
 *   再动手切生成单元。不要直接在几十万字的剧本里翻。
 */
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('用法: node dump-ep.js <结构化剧本.json> <集号> [关键词]');
  console.log('      node dump-ep.js <结构化剧本.json> --search <关键词>');
  process.exit(1);
}
const [jsonPath] = args;
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const allLines = (e) => {
  const out = e.lines.slice();
  for (const s of e.scenes) for (const l of s.lines) out.push(Object.assign({ sceneNo: s.sceneNo }, l));
  return out;
};

// ---------- 全剧检索模式 ----------
if (args[1] === '--search' || args[1] === '-s') {
  const kw = args[2];
  if (!kw) { console.log('✗ 请给出关键词'); process.exit(1); }
  console.log(`########## 全剧检索「${kw}」##########`);
  let n = 0;
  for (const e of data.episodes.filter((x) => x.ep > 0)) {
    for (const l of allLines(e)) {
      if ((l.text || '').includes(kw)) { console.log(`  E${e.ep}${l.sceneNo ? ' [' + l.sceneNo + ']' : ''}: [${l.type}] ${l.text}`); n++; }
    }
  }
  console.log(`\n命中 ${n} 处。`);
  process.exit(0);
}

// ---------- 单集导出 ----------
const TARGET = Number(args[1]);
const KEYWORD = args[2];
const ep = data.episodes.find((e) => e.ep === TARGET);
if (!ep) {
  const avail = data.episodes.map((e) => e.ep).join(',');
  console.log(`✗ 没有第 ${TARGET} 集。可用的集号：${avail}`);
  process.exit(1);
}

console.log(`########## 第 ${TARGET} 集 ##########`);
let diaChars = 0, osChars = 0, diaCount = 0, osCount = 0, actCount = 0, sfxCount = 0;
const marks = [], others = [];

for (const s of ep.scenes) {
  console.log(`\n--- 场 ${s.sceneNo} ｜ ${s.place} ｜ ${s.time} ｜ ${s.inner} ---`);
  for (const l of s.lines) {
    if (l.type === 'action') { actCount++; console.log(`  △ ${l.text}`); }
    else if (l.type === 'sfx') { sfxCount++; console.log(`  ${/^[「【]/.test(l.text) ? l.text : '「' + l.text + '」'}`); }
    else if (l.type === 'mark') { marks.push(`${s.sceneNo}: ${l.text}`); console.log(`  ${l.text}`); }
    else if (l.type === 'dialogue') {
      const n = (l.text || '').length;
      if (l.os) { osChars += n; osCount++; } else { diaChars += n; diaCount++; }
      console.log(`  [${l.who}${l.cue ? '（' + l.cue + '）' : ''}${l.os ? ' *OS*' : ''}] ${l.text}  (${n}字)`);
    } else { others.push(`${s.sceneNo}: ${l.text}`); console.log(`  · ${l.text}`); }
  }
}

console.log('\n########## 统计 ##########');
console.log(`场数=${ep.scenes.length}  台词条=${diaCount}  OS条=${osCount}  动作行=${actCount}  音效=${sfxCount}`);
console.log(`台词字=${diaChars}  OS字=${osChars}  合计=${diaChars + osChars}`);
console.log(`按 4.5 字/秒：台词约 ${((diaChars + osChars) / 4.5).toFixed(1)} 秒`);

if (marks.length) { console.log('\n--- 标记行 ---'); marks.forEach((m) => console.log('  ' + m)); }
if (others.length) { console.log('\n--- other 行（可能是画面文字，注意走字幕后期路线）---'); others.forEach((t) => console.log('  ' + t)); }

if (KEYWORD) {
  console.log(`\n########## 全剧检索「${KEYWORD}」##########`);
  let n = 0;
  for (const e of data.episodes.filter((x) => x.ep > 0)) {
    for (const l of allLines(e)) if ((l.text || '').includes(KEYWORD)) { console.log(`  E${e.ep}: [${l.type}] ${l.text}`); n++; }
  }
  console.log(`\n命中 ${n} 处。`);
}
