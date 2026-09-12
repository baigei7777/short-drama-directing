#!/usr/bin/env node
/**
 * check-coverage.js —— 剧本覆盖率校验（第一道门，优先于格式校验）
 *
 * 用法：
 *   node check-coverage.js <结构化剧本.json> <分镜表.md 或 分镜目录>
 *   node check-coverage.js <剧本全文.txt>   <分镜表.md 或 分镜目录>
 *
 * 干什么：逐条比对剧本里的每一句台词，检查它是否落到了分镜表里。
 *         找出「漏剧情」—— 分镜表格式再完美，漏了剧情就是废的。
 *
 * ★ 比对时只取分镜表「台词」列里引号内的对白内容，剥掉角色名与时长标注。
 *   否则长台词被拆成两镜时，中间的标注会打断连续性，产生假阳性。
 *
 * ★ 输出会打印「剧本台词条数」和「比对条数」。计数为 0 说明校验器失效了。
 */
const fs = require('fs');
const path = require('path');

// ---------- 从结构化 JSON 取台词 ----------
function dialogueFromJson(json, epNum) {
  const ep = (json.episodes || []).find((e) => e.ep === epNum);
  if (!ep) return null;
  const out = [];
  for (const l of (ep.lines || [])) if (l.type === 'dialogue' && (l.text || '').trim()) out.push({ who: l.who, text: l.text, os: !!l.os, scene: '' });
  for (const s of (ep.scenes || [])) {
    for (const l of (s.lines || [])) {
      if (l.type === 'dialogue' && (l.text || '').trim()) out.push({ who: l.who, text: l.text, os: !!l.os, scene: s.sceneNo || '' });
    }
  }
  return out;
}

// ---------- 从纯文本剧本取台词（启发式，与 parse-script.js 同一套规则） ----------
function dialogueFromText(txt, epNum) {
  const lines = txt.split('\n');
  const epRe = /^第\s*(\d+)\s*集\s*$/;
  const sceneRe = /^(\d+)\s*-\s*(\d+)\s*[，,]\s*(.+)$/;
  let cur = null, scene = '';
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const me = t.match(epRe);
    if (me) { cur = Number(me[1]); scene = ''; continue; }
    if (cur !== epNum) continue;
    const ms = t.match(sceneRe);
    if (ms) { scene = `${ms[1]}-${ms[2]}`; continue; }
    if (t.startsWith('△') || t.startsWith('「') || /^【[^】]*】$/.test(t)) continue;
    let m = t.match(/^([^：:（）()△「」【】]{1,16})[（(]([^）)]*)[）)][：:]\s*(.*)$/);
    if (m) { out.push({ who: m[1].trim(), text: m[3].trim(), os: /OS|内心|画外/i.test(m[2]), scene }); continue; }
    m = t.match(/^([^：:（）()△「」【】]{1,16})[：:]\s*(.*)$/);
    if (m) out.push({ who: m[1].trim(), text: m[2].trim(), os: false, scene });
  }
  return out;
}

// ---------- 从分镜表取引号内的对白 ----------
function dialogueFromStoryboard(file) {
  const text = fs.readFileSync(file, 'utf8');
  const quoted = [];
  for (const row of text.split('\n')) {
    if (!row.trim().startsWith('| U')) continue;
    const c = row.split('|');
    const cell = c[8] || '';              // 第 8 列 = 台词
    const re = /"([^"]+)"/g;
    let m;
    while ((m = re.exec(cell))) quoted.push(m[1]);
  }
  return quoted;
}

// 剥掉台词行里的「表演提示」——形如 （指脸颊）(whispering) 的括号内容。
// 这类内容**不是念出来的词**，分镜表里会把它转成画面动作，所以两侧都要剥掉，
// 否则剧本侧会多出几个字，比对不上，产生假阳性。
function stripCues(s) {
  return (s || '').replace(/[（(][^）)]*[）)]/g, '');
}

// 归一化：先剥表演提示，再去掉标点、空白
function norm(s) {
  return stripCues(s).replace(/[\s\u3000]/g, '').replace(/[，。！？、；：""''《》（）()【】\[\]…—·\-—.,!?;:'"<>「」]/g, '');
}

// ---------- 入口 ----------
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('用法: node check-coverage.js <结构化剧本.json 或 剧本全文.txt> <分镜表.md 或 分镜目录>');
  process.exit(1);
}
const [scriptPath, sbTarget] = args;

// 收集要校验的 (集号, 分镜表路径)
const targets = [];
if (fs.existsSync(sbTarget) && fs.statSync(sbTarget).isDirectory()) {
  for (const f of fs.readdirSync(sbTarget).filter((x) => /^E(\d+)-分镜表\.md$/.test(x)).sort()) {
    targets.push({ ep: Number(f.match(/^E(\d+)/)[1]), file: path.join(sbTarget, f) });
  }
  if (!targets.length) { console.log(`✗ 在 ${sbTarget} 里没找到 E*-分镜表.md`); process.exit(1); }
} else {
  const m = path.basename(sbTarget).match(/^E(\d+)/);
  if (!m) { console.log('✗ 分镜表文件名应以 E<集号> 开头，例如 E07-分镜表.md'); process.exit(1); }
  targets.push({ ep: Number(m[1]), file: sbTarget });
}

const isJson = scriptPath.toLowerCase().endsWith('.json');
const json = isJson ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : null;
const txt = isJson ? null : fs.readFileSync(scriptPath, 'utf8');

let totalScriptLines = 0, totalMatched = 0, totalMissing = 0, totalSkipped = 0;
const report = [];

for (const { ep, file } of targets) {
  const scriptDialogue = isJson ? dialogueFromJson(json, ep) : dialogueFromText(txt, ep);
  if (scriptDialogue === null || !scriptDialogue.length) {
    console.log(`E${String(ep).padStart(2, '0')}: ⚠️ 剧本里没取到第 ${ep} 集的台词（计数 0）—— 检查集号或剧本格式`);
    continue;
  }
  const sbQuoted = dialogueFromStoryboard(file);
  const sbText = norm(sbQuoted.join(''));

  let ptr = 0, matched = 0, skipped = 0;
  const missing = [];
  for (const l of scriptDialogue) {
    const t = norm(l.text);
    if (!t) { skipped++; continue; }   // 纯标点行（如"……"）没有可念的词，跳过但要计数
    const idx = sbText.indexOf(t, ptr);
    if (idx >= 0) { ptr = idx + t.length; matched++; continue; }
    const any = sbText.indexOf(t);
    if (any >= 0) { ptr = any + t.length; matched++; continue; }
    missing.push(l);
  }

  totalScriptLines += scriptDialogue.length;
  totalMatched += matched;
  totalSkipped += skipped;
  totalMissing += missing.length;

  const label = `E${String(ep).padStart(2, '0')}`;
  const skipNote = skipped ? `（另有 ${skipped} 条纯标点行已跳过，如"……"）` : '';
  console.log(`${label}: 剧本台词 ${scriptDialogue.length} 条 ｜ 分镜表对白片段 ${sbQuoted.length} 段 ｜ 命中 ${matched} 条${skipNote}  →  ${missing.length ? '❌ 漏 ' + missing.length + ' 条' : '✅ 全覆盖'}`);
  // 自检：总数必须等于 命中 + 跳过 + 漏掉，否则说明有台词被静默吞了
  if (scriptDialogue.length !== matched + skipped + missing.length) {
    console.log(`     ⚠️ 计数不符：${scriptDialogue.length} ≠ ${matched} + ${skipped} + ${missing.length} —— 有台词被静默跳过了，检查校验器`);
  }
  for (const m of missing) {
    console.log(`     漏：[${m.scene || label}] ${m.who}${m.os ? '（OS）' : ''}：${m.text}`);
  }
  if (missing.length) report.push({ label, missing });
}

console.log('\n=================== 检查计数（★ 若为 0 说明校验器失效，不是数据干净）===================');
console.log(`  剧本台词总数：${totalScriptLines}　命中：${totalMatched}　跳过(纯标点)：${totalSkipped}　漏掉：${totalMissing}`);
if (totalScriptLines !== totalMatched + totalSkipped + totalMissing) {
  console.log(`  ⚠️⚠️ 计数不符：${totalScriptLines} ≠ ${totalMatched}+${totalSkipped}+${totalMissing} —— 有台词被静默跳过！`);
}
if (totalScriptLines === 0) console.log('  ⚠️⚠️ 剧本台词总数为 0 —— 剧本格式与校验器不匹配，这次比对没有任何意义！');

if (report.length) {
  const out = path.join(path.dirname(targets[0].file), '_覆盖率检查.md');
  fs.writeFileSync(out,
    '# 剧本覆盖率检查\n\n' + report.map((r) =>
      `## ${r.label}（漏 ${r.missing.length} 条）\n\n` +
      r.missing.map((m) => `- [${m.scene}] **${m.who}**${m.os ? '（OS）' : ''}：${m.text}`).join('\n')
    ).join('\n\n') + '\n', 'utf8');
  console.log(`\n遗漏清单已写入：${out}`);
  process.exit(1);
}
process.exit(0);
