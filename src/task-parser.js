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
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    const window = remaining.slice(0, maxLen);
    const lastNl = window.lastIndexOf('\n');
    const cutAt = lastNl > maxLen / 2 ? lastNl + 1 : maxLen;
    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
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
  const KNOWN_KEYS = new Set(['repo','target_repo','mode','task','description','constraints','goal', 'create', 'modify', 'purpose', 'features']);
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
  const KEY_PATTERN = /\b(repo|target_repo|mode|task|description|constraints|goal|create|modify|purpose|features)\s*:/gi;
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
  const rawTask = (map.task || map.description || '').trim();
  const rawConstraints = (map.constraints || '').trim();
  const rawGoal = (map.goal || '').trim();

  const clean = (s) => s.replace(/^>\s*/, '').replace(/\/end_task\s*$/, '').trim();

  validateRequired({ targetRepo, taskDescription: rawTask });

  return {
    targetRepo,
    mode: normalizeMode(map.mode || 'codex_then_antigravity'),
    taskDescription: clean(rawTask),
    constraints: clean(rawConstraints),
    goal: clean(rawGoal),
    create: (map.create || '').trim(),
    modify: (map.modify || '').trim(),
    purpose: (map.purpose || '').trim(),
    features: (map.features || '').trim()
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
  // Priority 1: explicit file extension in phrase ("a .py script")
  const extMatch = d.match(/\.(html|jsx|py|js|json|csv|md|sql|css|yml|yaml)\b/);
  if (extMatch) return extMatch[1] === 'yaml' ? 'yml' : extMatch[1];
  // Priority 2: explicit named formats
  if (/landing.?page|html.?page|frontend|ui.?template/.test(d)) return 'html';
  if (/react component|jsx component/.test(d)) return 'jsx';
  if (/\bpython\b/.test(d) && !/javascript|node/.test(d)) return 'py';
  if (/\b(node\.?js|javascript)\b/.test(d)) return 'js';
  if (/json schema|data.?model|config(?:uration)? file/.test(d)) return 'json';
  if (/csv|dataset|spreadsheet/.test(d)) return 'csv';
  if (/markdown|readme|resume|report doc/.test(d)) return 'md';
  if (/\bsql\b|database migration/.test(d)) return 'sql';
  if (/stylesheet|\bcss\b/.test(d)) return 'css';
  if (/\byaml\b|\byml\b|docker.?compose/.test(d)) return 'yml';
  return 'md';
}

export function detectTaskShape(text) {
  if (!text) return { shape: 'single-file', files: [] };
  const t = sanitizeTelegram(text);
  const hasChunkProtocol = /\/\/ \[CONTINUES\]|\/\/ \[COMPLETE\]/.test(t);
  const fileRegex = /(?:^|\s|`)((?:\/|public\/|src\/|scripts\/|assets\/)[a-zA-Z0-9_\-./]+\.(?:html|jsx?|py|json|csv|md|sql|css|ya?ml|svg|txt))\b/gm;
  const matches = [...t.matchAll(fileRegex)].map(m => m[1].replace(/^`/, ''));
  const uniqueFiles = [...new Set(matches)];
  if (hasChunkProtocol) return { shape: 'chunked', files: uniqueFiles };
  if (uniqueFiles.length >= 2) return { shape: 'multi-file', files: uniqueFiles };
  return { shape: 'single-file', files: uniqueFiles };
}

export function buildFilename(description, outputType) {
  const slug = description.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40).replace(/-+$/, '');
  return `${slug || 'result'}.${outputType}`;
}
