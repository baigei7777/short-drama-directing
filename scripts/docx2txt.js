#!/usr/bin/env node
/**
 * docx2txt.js —— 零依赖 DOCX → 纯文本提取器
 *
 * 用法：node docx2txt.js <输入.docx> [输出.txt]
 *       不给输出路径时，打印到标准输出。
 *
 * 原理：DOCX 就是一个 ZIP，正文在 word/document.xml。
 *       手写 ZIP 中央目录解析 + zlib.inflateRawSync 解压 + 抽 <w:t> 文本。
 *       不依赖任何 npm 包，也不需要 Python / pandoc。
 */
const fs = require('fs');
const zlib = require('zlib');

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found — 这不是一个 zip/docx');
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central dir signature 损坏 @ ' + off);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const fnLen = buf.readUInt16LE(off + 28);
    const exLen = buf.readUInt16LE(off + 30);
    const cmLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + fnLen);
    entries.push({ name, method, compSize, localOff });
    off += 46 + fnLen + exLen + cmLen;
  }
  return entries;
}

function extractEntry(buf, e) {
  if (buf.readUInt32LE(e.localOff) !== 0x04034b50) throw new Error('local header 损坏 for ' + e.name);
  const fnLen = buf.readUInt16LE(e.localOff + 26);
  const exLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + fnLen + exLen;
  const raw = buf.slice(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的压缩方式 ' + e.method);
}

function docxXmlToText(xml) {
  let s = xml;
  s = s.replace(/<w:p\b[^>]*\/>/g, '\n');
  s = s.replace(/<\/w:p>/g, '\n');
  s = s.replace(/<w:br\b[^>]*\/?>/g, '\n');
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  s = s.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (m, t) => decodeEntities(t));
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const [, , inPath, outPath] = process.argv;
if (!inPath) { console.log('用法: node docx2txt.js <输入.docx> [输出.txt]'); process.exit(1); }

const buf = fs.readFileSync(inPath);
const entries = readZipEntries(buf);
const doc = entries.find((e) => e.name === 'word/document.xml');
if (!doc) { console.log('✗ 这个 docx 里没有 word/document.xml'); process.exit(1); }

const text = docxXmlToText(extractEntry(buf, doc).toString('utf8'));
if (outPath) {
  fs.writeFileSync(outPath, text, 'utf8');
  console.log(`✓ 提取完成：${text.length} 字符 / ${text.split('\n').length} 行 → ${outPath}`);
} else {
  process.stdout.write(text);
}
