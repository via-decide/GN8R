/**
 * task-parser.js
 * Robust Telegram message parser — handles YAML-style, JSON, and inline formats.
 * Ported and extended from Simba v2.
 */

const SANITIZE_MAP = [
  [/\u200B/g, ''], [/\u200C/g, ''], [/\u200D/g, ''], [/\uFEFF/g, ''],
  [/\u00A0/g, ' '], [/\u2011/g, '-'], [/\u2012/g, '-'], [/\u2013/g, '-'],
  [/\u2014/g, '-'], [/\u2018/g, "'"], [/\u2019/g, "'"], [/\u201C/g, '"'],
  [/\u201D/g, '"'], [/\u2026/g, '...'], [/\r\n/g, '\n'], [/\r/g, '\n'],
];

export function sanitizeTelegram(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  for (const [pattern, replacement] of SANITIZE_MAP) out = out.replace(pattern, replacement);
  return out;
}

export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const s = sanitizeTelegram(text);
  const codeBlock = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlock && isValidJson(codeBlock[1].trim())) return codeBlock[1].trim();
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  const candidate = s.slice(first, last + 1).trim();
  if (isValidJson(candidate)) return candidate;
  for (let end = last; end > first; end = s.lastIndexOf('}', end - 1)) {
    const sub = s.slice(first, end + 1);
    if (isValidJson(sub)) return sub;
  }
  return null;
}

function isValidJson(str) {
  try { JSON.parse(str); return true; } catch { return false; }
}

export function safeJsonParse(text, context = 'input') {
  const s = sanitizeTelegram(text || '');
  try { return JSON.parse(s); } catch {}
  const extracted = extractJson(s);
  if (extracted) { try { return JSON.parse(extracted); } catch {} }
  // Basic repair
  try {
    let r = s.trim().replace(/,\s*([}\]])/g, '$1');
    if (r.startsWith('{') && !r.endsWith('}')) r += '}';
    if (r.startsWith('[') && !r.endsWith(']')) r += ']';
    return JSON.parse(r);
  } catch {}
  throw new Error(`Could not parse ${context} as JSON. Input: "${s.slice(0, 60).replace(/\n/g, '\\n')}"`);
}

export function truncateForTelegram(text, maxLen = 4000) {
  if (!text || text.length <= maxLen) return text;
  const notice = '\n… (truncated)';
  return text.slice(0, maxLen - notice.length) + notice;
}

export function chunksForTelegram(text, maxLen = 4000) {
  if (!text) return [''];
  if (text.length <= maxLen) return [text];

  // Telegram hard limit is 4096 chars. We keep a lower safety buffer by default
  // and split on natural boundaries to preserve message formatting.
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= maxLen) {
      chunks.push(text.slice(cursor));
      break;
    }

    const window = text.slice(cursor, cursor + maxLen);
    const breakCandidates = [window.lastIndexOf('\n'), window.lastIndexOf(' ')].filter(i => i > 0);
    const bestBreak = breakCandidates.length ? Math.max(...breakCandidates) : -1;
    const cutAt = bestBreak >= Math.floor(maxLen * 0.6) ? bestBreak + 1 : maxLen;

    chunks.push(text.slice(cursor, cursor + cutAt));
    cursor += cutAt;
  }

  return chunks;
}

// ── Task message parser ───────────────────────────────────────

export function parseTaskMessage(text) {
  if (!text || typeof text !== 'string') throw new Error('Task message is empty.');
  const cleaned = sanitizeTelegram(text).trim();
  if (!cleaned) throw new Error('Task message is empty after sanitization.');
  if (cleaned.startsWith('{')) return parseJsonTask(cleaned);
  const hasNewlines = cleaned.includes('\n');
  if (!hasNewlines && looksLikeInlineYaml(cleaned)) return parseInlineYaml(cleaned);
  return parseYamlTask(cleaned);
}

function parseJsonTask(text) {
  let obj;
  try { obj = safeJsonParse(text, 'task message'); }
  catch (err) { throw new Error(`JSON task parse failed: ${err.message}`); }
  const targetRepo = String(obj.repo || obj.targetRepo || '').trim();
  const taskDescription = String(obj.task || obj.taskDescription || obj.description || '').trim();
  const mode = String(obj.mode || 'codex_then_antigravity').trim().toLowerCase();
  validateRequired({ targetRepo, taskDescription });
  return { targetRepo, mode: normalizeMode(mode), taskDescription,
    constraints: String(obj.constraints || '').trim(), goal: String(obj.goal || '').trim() };
}

function parseYamlTask(text) {
  const KNOWN_KEYS = new Set(['repo','target_repo','mode','task','description','constraints','goal']);
  const lines = text.split('\n');
  const map = {}; let lastKey = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { if (lastKey) map[lastKey] = (map[lastKey] + ' ' + line).trim(); continue; }
    const keyCandidate = line.slice(0, colonIdx).trim().toLowerCase().replace(/[\s-]/g, '_');
    const valueRaw = line.slice(colonIdx + 1).trim();
    if (KNOWN_KEYS.has(keyCandidate) || (colonIdx <= 20 && /^[a-z_]+$/.test(keyCandidate))) {
      map[keyCandidate] = valueRaw; lastKey = keyCandidate;
    } else if (lastKey) { map[lastKey] = (map[lastKey] + ' ' + line).trim(); }
  }
  return buildTaskFromMap(map);
}

function looksLikeInlineYaml(text) {
  return /\brepo\s*:/.test(text) || /\btask\s*:/.test(text);
}

function parseInlineYaml(text) {
  const KEY_PATTERN = /\b(repo|target_repo|mode|task|description|constraints|goal)\s*:/gi;
  const segments = []; let match;
  while ((match = KEY_PATTERN.exec(text)) !== null) {
    if (segments.length > 0) segments[segments.length - 1].end = match.index;
    segments.push({ key: match[1].toLowerCase(), start: match.index + match[0].length, end: text.length });
  }
  const map = {};
  for (const seg of segments) map[seg.key] = text.slice(seg.start, seg.end).trim();
  return buildTaskFromMap(map);
}

function buildTaskFromMap(map) {
  const targetRepo = (map.repo || map.target_repo || '').trim();
  const taskDescription = (map.task || map.description || '').trim();
  validateRequired({ targetRepo, taskDescription });
  return {
    targetRepo, mode: normalizeMode(map.mode || 'codex_then_antigravity'),
    taskDescription, constraints: (map.constraints || '').trim(), goal: (map.goal || '').trim()
  };
}

function normalizeMode(mode) {
  const valid = ['codex', 'antigravity', 'antigravity_repair', 'codex_then_antigravity'];
  if (valid.includes(mode)) return mode;
  if (mode === 'repair') return 'antigravity_repair';
  if (mode === 'both') return 'codex_then_antigravity';
  return 'codex_then_antigravity';
}

function validateRequired({ targetRepo, taskDescription }) {
  const errors = [];
  if (!targetRepo) errors.push('repo: (e.g. repo: owner/repo-name)');
  else if (!targetRepo.includes('/')) errors.push('repo must be in owner/repo format');
  if (!taskDescription) errors.push('task: (describe what to do)');
  if (errors.length) {
    throw new Error(
      `Task message missing required fields:\n${errors.map(e => `  • ${e}`).join('\n')}\n\n` +
      `Example:\nrepo: via-decide/decide.engine-tools\nmode: codex_then_antigravity\ntask: create idea-remixer tool`
    );
  }
}

// ── Simple /task parser for user-facing file generation ──────

export function parseUserTask(text) {
  if (!text) return null;
  const description = text.replace(/^\/task(@\w+)?\s*/i, '').trim();
  if (!description) return null;
  if (description.length > 2000) return { error: 'Task too long. Max 2000 characters.' };
  return { description };
}

export function detectOutputType(description) {
  const d = description.toLowerCase();
  if (/landing.?page|html.?page|frontend|ui.?template/.test(d)) return 'html';
  if (/react|component|jsx/.test(d)) return 'jsx';
  if (/python|\.py|script.*(data|parse|csv)/.test(d)) return 'py';
  if (/javascript|node\.?js|\.js|tool.*js/.test(d)) return 'js';
  if (/json|data.?model|schema|config/.test(d)) return 'json';
  if (/csv|dataset|spreadsheet/.test(d)) return 'csv';
  if (/markdown|readme|\.md|doc|resume|report/.test(d)) return 'md';
  if (/sql|database|migration/.test(d)) return 'sql';
  if (/css|stylesheet/.test(d)) return 'css';
  if (/yaml|yml|docker/.test(d)) return 'yml';
  return 'md';
}

export function buildFilename(description, outputType) {
  const slug = description.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40).replace(/-+$/, '');
  return `${slug || 'result'}.${outputType}`;
}
