/**
 * task-generator.js — Tool catalog + task generation (ported from Simba v2)
 */

import {
  buildEngineAwareTask, discoverMissingTools,
  fetchAllRegisteredTools, resolveToolCategory,
  formatRegistryReport, formatMissingToolsReport,
} from './engine-bridge.js';

export { discoverMissingTools, fetchAllRegisteredTools, formatRegistryReport, formatMissingToolsReport };

export const TOOL_CATALOG = {
  games: [
    { id: 'tetris-game', title: 'Tetris Game', description: 'Falling block puzzle with rotation and line clears.', rationale: 'High engagement, universally known.' },
    { id: 'puzzle-generator', title: 'Puzzle Generator', description: 'Generate logic puzzles with answer checking.', rationale: 'Reusable puzzle framework.' },
    { id: 'memory-match', title: 'Memory Match', description: 'Card flip memory game with scoring and timer.', rationale: 'Simple and addictive on mobile.' },
    { id: 'typing-speed', title: 'Typing Speed Test', description: 'Measure WPM with accuracy tracking.', rationale: 'Practical utility game.' },
    { id: 'quiz-engine', title: 'Quiz Engine', description: 'Configurable quiz with JSON-driven questions.', rationale: 'Foundation for topic-specific quizzes.' },
  ],
  business: [
    { id: 'swot-analyzer', title: 'SWOT Analyzer', description: 'Structured SWOT analysis with export.', rationale: 'Simplest business tool entry point.' },
    { id: 'okr-planner', title: 'OKR Planner', description: 'Define objectives and key results with progress tracking.', rationale: 'Essential for founders.' },
    { id: 'pricing-calculator', title: 'Pricing Calculator', description: 'Compare pricing models: freemium, tiered, usage-based.', rationale: 'High-value decision tool.' },
    { id: 'lean-canvas', title: 'Lean Canvas Builder', description: 'One-page business model canvas with export.', rationale: 'Standard founder tool.' },
  ],
  education: [
    { id: 'flashcard-engine', title: 'Flashcard Engine', description: 'Spaced repetition flashcard tool with JSON decks.', rationale: 'Core study tool.' },
    { id: 'pomodoro-timer', title: 'Pomodoro Timer', description: '25/5 focus/break timer with session tracking.', rationale: 'Universal productivity tool.' },
    { id: 'note-organizer', title: 'Note Organizer', description: 'Tag-based note system with search.', rationale: 'Foundational study aid.' },
    { id: 'formula-sheet', title: 'Formula Sheet Builder', description: 'Build and export LaTeX/plain formula sheets.', rationale: 'High utility for STEM students.' },
  ],
  creators: [
    { id: 'thumbnail-brief', title: 'Thumbnail Brief Generator', description: 'Generate visual briefs for YouTube thumbnails.', rationale: 'Solves a real creator workflow gap.' },
    { id: 'content-calendar', title: 'Content Calendar', description: 'Weekly content planning grid with export.', rationale: 'Essential for consistent creators.' },
    { id: 'hook-generator', title: 'Hook Generator', description: 'Generate scroll-stopping intros for posts.', rationale: 'Highest-leverage creator tool.' },
  ],
  misc: [
    { id: 'unit-converter', title: 'Unit Converter', description: 'Convert between units: length, mass, temp, currency.', rationale: 'Universal utility.' },
    { id: 'color-palette', title: 'Color Palette Generator', description: 'Generate harmonious color palettes with hex codes.', rationale: 'Used by designers and devs daily.' },
    { id: 'markdown-previewer', title: 'Markdown Previewer', description: 'Live markdown preview with export to HTML.', rationale: 'Universally useful for writers.' },
  ],
};

export function getCatalogSummary() {
  const summary = {};
  for (const [cat, tools] of Object.entries(TOOL_CATALOG)) {
    summary[cat] = { total: tools.length, tools: tools.map(t => t.id) };
  }
  return summary;
}

export async function generateTasks(config, options = {}) {
  const { categories = null, maxTasks = 20, excludeIds = new Set() } = options;

  const catalog = categories
    ? Object.fromEntries(Object.entries(TOOL_CATALOG).filter(([cat]) => categories.includes(cat)))
    : TOOL_CATALOG;

  const tasks = [];
  for (const [category, tools] of Object.entries(catalog)) {
    for (const tool of tools) {
      if (excludeIds.has(tool.id)) continue;
      if (tasks.length >= maxTasks) break;
      tasks.push(buildEngineAwareTask({ ...tool, category }));
    }
  }
  return tasks;
}

export async function generateNextTask(config, stateEngine, chatId) {
  const queue = await stateEngine.getTaskQueue(chatId);
  if (queue.pending.length > 0) {
    const next = queue.pending[0];
    return {
      targetRepo: 'via-decide/decide.engine-tools',
      mode: 'codex_then_antigravity',
      taskDescription: next.taskDescription,
      constraints: next.constraints || '',
      goal: next.goal || next.taskDescription,
      metadata: next.metadata || {},
      toolId: next.toolId,
    };
  }
  // Generate fresh tasks
  const completedIds = new Set(queue.completed.map(t => t.toolId).filter(Boolean));
  const failedIds    = new Set(queue.failed.map(t => t.toolId).filter(Boolean));
  const excludeIds   = new Set([...completedIds, ...failedIds]);
  const fresh = await generateTasks(config, { maxTasks: 10, excludeIds });
  if (!fresh.length) return null;
  for (const task of fresh) {
    await stateEngine.addToQueue(chatId, { toolId: task.metadata?.toolId, ...task });
  }
  return fresh[0];
}

export function formatTaskListForTelegram(tasks) {
  if (!tasks.length) return 'No tasks generated.';
  return tasks.slice(0, 15).map((t, i) => {
    const id = t.metadata?.toolId || `task-${i + 1}`;
    const cat = t.metadata?.category || '?';
    const short = t.taskDescription?.slice(0, 60) || '';
    return `${i + 1}. [${cat}] ${id}\n   ${short}`;
  }).join('\n');
}

export function formatTaskForTelegram(task) {
  if (!task) return 'No task.';
  return [
    `Tool: ${task.metadata?.toolId || '?'}`,
    `Category: ${task.metadata?.category || '?'}`,
    `Repo: ${task.targetRepo}`,
    `Mode: ${task.mode}`,
    `Goal: ${task.goal?.slice(0, 100) || '?'}`,
  ].join('\n');
}
