#!/usr/bin/env node
/**
 * parse-script.js —— 短剧剧本结构化解析器
 *
 * 用法：node parse-script.js <剧本全文.txt> [输出.json]
 *
 * 识别的剧本格式（中文短剧常见写法）：
 *   `第 N 集`                        → 集
 *   `N-M，地点，时间，内/外`          → 场
 *   `△动作描述`                       → 动作行
 *   `「音效」`                        → 音效
 *   `【标记】`                        → 标记（闪回、字幕、卡点等）
 *   `角色（表演提示）：台词`           → 台词（提示里含 OS/内心/画外 则标记为内心独白）
 *   `角色：台词`                      → 台词
 *
 * 如果你的剧本格式不同，改 EP_RE / SCENE_RE / 台词那两段正则即可。
 *
 * 输出 JSON 结构：
 *   { meta, speakers[], places[], episodeStats[], episodes[{ep, scenes[{sceneNo,place,time,inner,lines[]}], lines[]}] }
 */
const fs = require('fs');

const args = process.argv.slice(2);
if (!args.length) { console.log('用法: node parse-script.js <剧本全文.txt> [输出.json]'); process.exit(1); }
const [inPath, outPath] = args;

const raw = fs.readFileSync(inPath, 'utf8');
const lines = raw.split('\n');

const EP_RE = /^第\s*(\d+)\s*集\s*$/;
const SCENE_RE = /^(\d+)\s*-\s*(\d+)\s*[，,]\s*(.+)$/;

const episodes = [];
let ep = null, scene = null;

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (!t) continue;
  const ln = i + 1;

  const mEp = t.match(EP_RE);
  if (mEp) { ep = { ep: Number(mEp[1]), srcLine: ln, scenes: [], lines: [] }; episodes.push(ep); scene = null; continue; }
  if (!ep) continue;   // 第 1 集之前的内容（立项页等）跳过

  const mSc = t.match(SCENE_RE);
  if (mSc) {
    const parts = mSc[3].split(/[，,]/).map((s) => s.trim()).filter(Boolean);
    let inner = '';
    if (parts.length && /^(内|外)/.test(parts[parts.length - 1])) inner = parts.pop();
    const time = parts.length > 1 ? parts.pop() : '';
    scene = { sceneNo: `${mSc[1]}-${mSc[2]}`, place: parts.join('，'), time, inner, srcLine: ln, lines: [] };
    ep.scenes.push(scene);
    continue;
  }

  const target = scene || ep;
  const push = (type, payload) => target.lines.push(Object.assign({ type, ln }, payload));

  if (t.startsWith('△')) { push('action', { text: t.replace(/^△/, '').trim() }); continue; }
  if (t.startsWith('「')) { push('sfx', { text: t.replace(/^「|」$/g, '').trim() }); continue; }
  if (/^【[^】]*】$/.test(t)) { push('mark', { text: t }); continue; }

  let m = t.match(/^([^：:（）()△「」【】]{1,16})[（(]([^）)]*)[）)][：:]\s*(.*)$/);
  if (m) { push('dialogue', { who: m[1].trim(), cue: m[2].trim(), text: m[3].trim(), os: /OS|内心|画外/i.test(m[2]) }); continue; }
  m = t.match(/^([^：:（）()△「」【】]{1,16})[：:]\s*(.*)$/);
  if (m) { push('dialogue', { who: m[1].trim(), cue: '', text: m[2].trim(), os: false }); continue; }

  push('other', { text: t });
}

// ---------- 汇总 ----------
const allLines = (e) => {
  const out = e.lines.slice();
  for (const s of e.scenes) for (const l of s.lines) out.push(Object.assign({ sceneNo: s.sceneNo }, l));
  return out;
};

const speakers = new Map(), places = new Map(), speakersByEp = new Map();
for (const e of episodes) {
  const set = new Set();
  for (const l of allLines(e)) {
    if (l.type !== 'dialogue' || !l.who) continue;
    speakers.set(l.who, (speakers.get(l.who) || 0) + 1);
    set.add(l.who);
  }
  speakersByEp.set(e.ep, set);
  for (const s of e.scenes) places.set(s.place, (places.get(s.place) || 0) + 1);
}

function epStats(e) {
  let dia = 0, os = 0, action = 0, sfx = 0, chars = 0, marks = [];
  for (const l of allLines(e)) {
    if (l.type === 'dialogue') { dia++; if (l.os) os++; chars += (l.text || '').length; }
    else if (l.type === 'action') { action++; chars += (l.text || '').length; }
    else if (l.type === 'sfx') { sfx++; chars += (l.text || '').length; }
    else if (l.type === 'mark') marks.push(l.text);
  }
  return { dia, os, action, sfx, chars, marks };
}

const episodeStats = episodes.map((e) => {
  const s = epStats(e);
  return { ep: e.ep, scenes: e.scenes.length, dia: s.dia, os: s.os, action: s.action, chars: s.chars, speakers: [...(speakersByEp.get(e.ep) || [])], marks: s.marks.join(' ') };
});

const result = {
  meta: { source: inPath, episodeCount: episodes.length, totalLines: lines.length, totalChars: raw.length, parsedAt: new Date().toISOString() },
  speakers: [...speakers.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  places: [...places.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  episodeStats, episodes,
};

if (outPath) { fs.writeFileSync(outPath, JSON.stringify(result, null, 1), 'utf8'); }

const real = episodes.filter((e) => e.ep > 0);
const diaCount = real.reduce((a, e) => a + episodeStats.find((s) => s.ep === e.ep).dia, 0);
console.log(`✓ 解析完成：${episodes.length} 集（含第 0 集立项页）／人物 ${speakers.size} 个／地点写法 ${places.size} 种`);
console.log(`  台词条数合计 ${diaCount}　全剧字数 ${raw.length}`);
if (outPath) console.log(`  → ${outPath}`);
if (episodes.length === 0) console.log('  ⚠️ 一集都没解析出来 —— 剧本的集标记格式与 EP_RE 不匹配，检查一下。');
