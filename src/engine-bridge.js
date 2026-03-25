/**
 * engine-bridge.js — Bridges the bot to the live decide.engine-tools repo.
 * Merged from Simba's decide-engine-bridge.js + original engine-bridge.js
 */

export const CATEGORY_MAP = {
  creators: 'creators', coders: 'coders', researchers: 'researchers',
  operators: 'business', founders: 'business', students: 'education',
  gamers: 'games', engine: 'simulations', system: 'system', misc: 'misc',
};

export const ENGINE_TOOL_IDS = new Set([
  'engine-state-manager', 'llm-action-parser', 'daily-weather-replenisher',
  'admin-moderation-panel', 'simulation-runner', 'player-signup',
  'orchard-profile-builder', 'root-strength-calculator', 'trunk-growth-calculator',
  'fruit-yield-engine', 'daily-quest-generator', 'weekly-harvest-engine',
  'thirty-day-promotion-engine', 'fair-ranking-engine', 'seed-exchange',
  'fruit-sharing', 'circle-builder', 'peer-validation-engine', 'trust-score-engine',
  'recruiter-dashboard', 'orchard-discovery-search', 'hire-readiness-scorer',
  'four-direction-pipeline', 'growth-path-recommender', 'ai-coach-console',
  'seed-quality-scorer', 'meta-health-dashboard', 'synthetic-player-generator',
  'wave1-simulation-runner', 'balance-dashboard', 'growth-milestone-engine',
]);

export const IMPORTABLE_TOOL_DIRS = [
  'tools/promptalchemy', 'tools/script-generator', 'tools/spec-builder',
  'tools/code-generator', 'tools/code-reviewer', 'tools/tool-router',
  'tools/export-studio', 'tools/template-vault', 'tools/idea-remixer',
  'tools/task-splitter', 'tools/prompt-compare', 'tools/repo-improvement-brief',
  'tools/workflow-template-gallery', 'tools/tool-search-discovery',
  'tools/context-packager', 'tools/output-evaluator',
  'tools/engine/player-signup', 'tools/engine/orchard-profile-builder',
  'tools/engine/starter-farm-generator', 'tools/engine/root-strength-calculator',
  'tools/engine/trunk-growth-calculator', 'tools/engine/fruit-yield-engine',
  'tools/engine/daily-quest-generator', 'tools/engine/weekly-harvest-engine',
  'tools/engine/thirty-day-promotion-engine', 'tools/engine/fair-ranking-engine',
  'tools/engine/seed-exchange', 'tools/engine/fruit-sharing',
  'tools/engine/circle-builder', 'tools/engine/peer-validation-engine',
  'tools/engine/trust-score-engine', 'tools/engine/recruiter-dashboard',
  'tools/engine/orchard-discovery-search', 'tools/engine/hire-readiness-scorer',
  'tools/engine/four-direction-pipeline', 'tools/engine/growth-path-recommender',
  'tools/engine/ai-coach-console', 'tools/engine/simulation-runner',
  'tools/engine/seed-quality-scorer', 'tools/engine/meta-health-dashboard',
  'tools/engine/synthetic-player-generator', 'tools/engine/wave1-simulation-runner',
  'tools/engine/balance-dashboard', 'tools/engine/growth-milestone-engine',
  'tools/games/hex-wars', 'tools/games/wings-of-fire-quiz',
  'tools/engine/script-generator-files', 'tools/engine/layer1-swipe-crucible',
];

const ENGINE_TOOLS_REPO = 'via-decide/decide.engine-tools';

export function resolveToolCategory(category) {
  return CATEGORY_MAP[category] || category || 'misc';
}

export function isEngineTool(id, category, entryPath = '') {
  if (ENGINE_TOOL_IDS.has(id)) return true;
  const normalized = resolveToolCategory(category);
  if (normalized === 'simulations' || normalized === 'system') return true;
  return entryPath.toLowerCase().startsWith('tools/engine/');
}

// ── Live registry fetching ─────────────────────────────────────

let _manifestCache = null;
let _manifestAt = 0;
const MANIFEST_TTL = 10 * 60 * 1000;

export async function fetchLiveManifest(engineBaseUrl) {
  const now = Date.now();
  if (_manifestCache && now - _manifestAt < MANIFEST_TTL) return _manifestCache;
  try {
    const res = await fetch(`${engineBaseUrl}/tools-manifest.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _manifestCache = await res.json();
    _manifestAt = now;
    return _manifestCache;
  } catch { return { entries: [], fallback: true }; }
}

export async function fetchRegistryConfig(toolDir, config) {
  const [owner, repo] = ENGINE_TOOLS_REPO.split('/');
  const filePath = `${toolDir}/config.json`.replace(/^\//, '');
  const url = `${config.githubApiBaseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding !== 'base64' || !data.content) return null;
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  } catch { return null; }
}

export async function fetchAllRegisteredTools(config) {
  const results = await Promise.all(
    IMPORTABLE_TOOL_DIRS.map(async dir => {
      const meta = await fetchRegistryConfig(dir, config);
      if (!meta) return null;
      const id = meta.id || dir.split('/').pop();
      return {
        dir, id,
        name: meta.name || id,
        description: meta.description || '',
        category: resolveToolCategory(meta.category),
        isEngineTool: isEngineTool(id, meta.category, meta.entry || `${dir}/index.html`),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
      };
    })
  );
  return results.filter(Boolean);
}

export async function discoverMissingTools(catalog, config) {
  let liveIds;
  try {
    const liveTools = await fetchAllRegisteredTools(config);
    liveIds = new Set(liveTools.map(t => t.id));
  } catch { liveIds = new Set(); }
  for (const dir of IMPORTABLE_TOOL_DIRS) liveIds.add(dir.split('/').pop());

  const missing = [];
  for (const [category, tools] of Object.entries(catalog)) {
    for (const tool of tools) {
      if (!liveIds.has(tool.id)) missing.push({ category, ...tool });
    }
  }
  return missing;
}

export function buildEngineAwareTask({ id, title, description, category, isGame = false, isEngine = false }) {
  const categoryNorm = resolveToolCategory(category);
  const isEngineLayer = isEngine || isEngineTool(id, category);
  let toolDir = isEngineLayer ? `tools/engine/${id}` : (isGame || categoryNorm === 'games') ? `tools/games/${id}` : `tools/${id}`;

  const sharedDeps = isEngineLayer
    ? 'shared/engine-utils.js, shared/engine-models.js, shared/tool-storage.js, shared/shared.css'
    : 'shared/tool-storage.js, shared/shared.css';

  const taskDescription = [
    `Add a new standalone tool "${title}" (id: ${id}) at ${toolDir}/.`,
    `Description: "${description}".`,
    `Category: "${category}" (normalized: "${categoryNorm}").`,
    `Required files: ${toolDir}/config.json, ${toolDir}/index.html, ${toolDir}/tool.js.`,
    `config.json must include: id, name, description, category, audience, inputs, outputs, tags.`,
    isEngineLayer
      ? `Engine layer tool. Load ${sharedDeps}. Follow engine-models.js patterns.`
      : `Load ${sharedDeps}. Use ToolStorage for persistence. No external frameworks.`,
    `Register in shared/tool-registry.js: add "${toolDir}" to importableToolDirs.`,
    `Register in router.js: add to the tool path static map.`,
    `Do NOT modify any existing tool folder or break existing shared utilities.`,
  ].join(' ');

  return {
    targetRepo: ENGINE_TOOLS_REPO,
    mode: 'codex_then_antigravity',
    taskDescription,
    constraints: 'preserve all existing tool folders and shared modules; additive changes only; do not break category routing',
    goal: `Produce working ${id} tool registered in tool-registry.js and router.js under "${categoryNorm}".`,
    metadata: { category: categoryNorm, toolId: id, toolTitle: title, toolDir, isEngineLayer, isGame: isGame || categoryNorm === 'games', generatedAt: new Date().toISOString(), source: 'engine-bridge' },
  };
}

export async function buildEngineContext(engineBaseUrl) {
  const manifest = await fetchLiveManifest(engineBaseUrl);
  const entries = manifest.entries || [];
  if (!entries.length) {
    return `The Decide Engine tool ecosystem (${ENGINE_TOOLS_REPO}) has 50+ tools including code generators, study tools, agent workflows, orchard game engine, and business tools.`;
  }
  const toolList = entries.slice(0, 30).map(e => `• ${e.toolDir?.split('/').pop() || 'tool'}`).join('\n');
  return `The Decide Engine tool ecosystem (${ENGINE_TOOLS_REPO}) has ${entries.length} registered tools:\n${toolList}${entries.length > 30 ? `\n... and ${entries.length - 30} more` : ''}`;
}

export function formatRegistryReport(tools) {
  if (!tools.length) return '⚠ No tools discovered from live registry.';
  const byCategory = {};
  for (const tool of tools) {
    const cat = tool.category || 'misc';
    (byCategory[cat] = byCategory[cat] || []).push(tool);
  }
  const lines = [`📦 decide.engine-tools registry (${tools.length} tools):\n`];
  for (const [cat, list] of Object.entries(byCategory).sort()) {
    lines.push(`[${cat}] (${list.length})`);
    list.slice(0, 5).forEach(t => lines.push(`  • ${t.id}${t.isEngineTool ? ' 🔧' : ''}`));
    if (list.length > 5) lines.push(`  ... +${list.length - 5} more`);
  }
  return lines.join('\n');
}

export function formatMissingToolsReport(missing) {
  if (!missing.length) return '✅ All catalogued tools are registered in the live repo.';
  const lines = [`🔍 Missing tools (${missing.length} gaps found):\n`];
  missing.slice(0, 15).forEach(t => lines.push(`[${t.category}] ${t.id} — ${t.title}`));
  if (missing.length > 15) lines.push(`... +${missing.length - 15} more`);
  lines.push('\nUse /generate to queue tasks for these tools.');
  return lines.join('\n');
}
