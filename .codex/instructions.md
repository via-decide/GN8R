# CODEX AGENT RULES — via-decide/decide.engine-tools
# Place this file at: .codex/instructions.md
# Codex reads this before every task in this repo.

════════════════════════════════════════════
REPO IDENTITY
════════════════════════════════════════════

Stack: Vanilla JS, HTML, CSS, Supabase CDN.
No build step. No npm. No bundler. No React.
Everything runs directly in the browser.
GitHub Pages host: https://via-decide.github.io/decide.engine-tools/

════════════════════════════════════════════
THE PRIME DIRECTIVE
════════════════════════════════════════════

READ every file you are about to change.
Understand what it does before touching it.
If you are unsure what a line does — do not change it.
Surgical edits only. Never rewrite whole files.

════════════════════════════════════════════
FILES YOU MUST NEVER MODIFY
════════════════════════════════════════════

These files are marked DO NOT MODIFY or are too risky:

  tools/games/skillhex-mission-control/js/app.js
    → comment at top says DO NOT MODIFY
    → ES module, single entry point for entire game
    → only allowed addition: one wallet sync block
      AFTER saveState() in renderCycle() — nothing else

  tools/games/hex-wars/index.html → QUESTIONS array
    → 30+ hand-written quiz questions, never delete or reorder

  shared/shared.css
    → base CSS for all engine tools, no overrides

  _redirects
    → Netlify routing, do not touch

  tools-manifest.json
    → only add entries, never delete existing ones

  missions.json (skillhex)
    → hand-authored mission data, never modify

════════════════════════════════════════════
FUNCTION BODIES — NEVER TOUCH
════════════════════════════════════════════

These functions work correctly. Do not modify their bodies.
Only ever add NEW code AFTER them, never inside them.

  hex-wars:      calcPoints(), showResult(), restart(),
                 loadQuestion(), updateStats(), haptic()

  skillhex:      handleDecision(), advanceMission(),
                 calculateScore(), renderCycle(), initApp()

  snake-game:    step(), draw(), reset(), spawnFood()

  wings-quiz:    selectAnswer(), showQuestion(), startTimer(),
                 broadcast(), createRoom(), joinRoom()

  layer1-swipe:  commitSwipe(), finishSession(), buildCardElement(),
                 startSessionIfEligible(), hydrateState(), syncState()

  growth-engine: anything inside the Three.js animation loop
                 (requestAnimationFrame callbacks)

════════════════════════════════════════════
SCRIPT TAG LOADING ORDER — CRITICAL
════════════════════════════════════════════

Wrong script order silently breaks entire pages.
Always follow this order in <head>:

  1. Three.js CDN (if used) — ALWAYS first
  2. Other CDN scripts (chart.js, supabase, pdf.js)
  3. shared/vd-nav-fix.js
  4. shared/vd-wallet.js (if needed)
  5. shared/tool-storage.js (if needed)
  6. Other shared/*.js files
  7. Inline <script> OR type="module" scripts — ALWAYS LAST

NEVER add script tags after the closing </body>.
NEVER add script tags after an existing inline <script> block.
NEVER load a shared script after the game's own script.

════════════════════════════════════════════
ES MODULES vs PLAIN SCRIPTS
════════════════════════════════════════════

SkillHex uses ES modules (type="module").
All other games use plain scripts.
These two systems do not mix freely.

Rules:
  - window.VDWallet, window.ToolBridge etc are set by plain scripts
  - ES modules can access window.* globals BUT only if the plain
    script loaded first in the HTML
  - NEVER add type="module" to shared scripts
  - NEVER use import/export in shared/*.js files
    (they use IIFE pattern: (function(global){...})(window))
  - ALWAYS wrap window.* calls inside ES modules with a guard:
      if (typeof window.VDWallet !== 'undefined') { ... }

════════════════════════════════════════════
SYNTAX RULES — THE ONES THAT KILLED THE SITE
════════════════════════════════════════════

1. NO DUPLICATE CONST
   Never declare the same const twice in the same scope.
   Always grep for existing declarations before adding new ones:
     grep -n "const varName" filename.js

2. NO ORPHANED OBJECTS
   Every { } object literal must be inside an array, assignment,
   or function call. Never leave object literals floating alone.

3. DOLLAR-QUOTE FUNCTIONS (SQL)
   Always use $$ not $func$ for PostgreSQL function bodies.
   Supabase SQL editor requires standard $$ delimiter.

4. NO !important ON transform OR opacity
   These properties are set by inline styles in game engines.
   CSS !important overrides inline styles and breaks animations.
   Never use !important on transform or opacity on game card elements.

5. IIFE STRUCTURE
   router.js and all shared/*.js files use this pattern:
     (() => { 'use strict'; ... })();
   or
     (function(global){ ... })(window);
   Do not break the opening or closing of these wrappers.

════════════════════════════════════════════
SHARED ECONOMY — SAFE WIRING PATTERN
════════════════════════════════════════════

The shared VDWallet economy connects all games.
Here is the ONLY safe way to wire it into any game:

STEP 1 — add script tag in <head> (correct position per above)
STEP 2 — create a NEW function outside all existing functions:

  function awardGameCredits(params) {
    if (typeof window.VDWallet === 'undefined') return;
    window.VDWallet.earn('fieldName', amount, 'source-id');
  }

STEP 3 — call that new function from ONE safe location:
  - after a correct answer is processed
  - after a game session ends
  - after a score is calculated
  NOT inside render loops, NOT inside timer callbacks,
  NOT inside requestAnimationFrame callbacks.

STEP 4 — always guard with typeof check.
  The game must function identically whether VDWallet
  is present or not. It is an enhancement, not a dependency.

VDWallet field names:
  focusDrops  — general study/quiz rewards
  lumina      — streak and milestone rewards
  hexTokens   — HexWars specific
  missionXP   — SkillHex specific
  snakeCoins  — Snake game specific
  quizStars   — Wings of Fire Quiz specific

════════════════════════════════════════════
SUPABASE RULES
════════════════════════════════════════════

Project URL: https://bfocxgtlemhxfwfuhlxn.supabase.co
Anon key: set by developer, stored as window.ECO_SUPABASE_ANON_KEY

  - NEVER hardcode the anon key in committed files
  - NEVER use process.env in browser HTML files
    (process.env is Node.js only, undefined in browsers)
  - ALWAYS use column name snake_case to match the DB schema:
      focus_drops NOT focusDrops
      plant_level NOT plantLevel
      plant_hydration NOT plantHydration
  - ALWAYS use .single() when fetching one row
  - ALWAYS handle the error field from Supabase responses
  - NEVER call .rpc() without verifying the function exists in SQL

════════════════════════════════════════════
GITHUB PAGES PATH RULES
════════════════════════════════════════════

The site lives at: /decide.engine-tools/ NOT at /

  - href="/" in vd-nav-fix.js → 404. Must be dynamic.
  - All internal links must use relative paths: ./path or ../path
  - Never use absolute paths like /tools/games/...
  - Back button must compute base path from window.location.pathname

Depth reference for script src paths:
  root level files (index.html):          ./shared/
  depth 1 (agent/, founder/):             ../shared/
  depth 2 (tools/something/):             ../../shared/
  depth 3 (tools/games/game/ or
           tools/engine/tool/):           ../../../shared/

════════════════════════════════════════════
BEFORE EVERY COMMIT — RUN THESE CHECKS
════════════════════════════════════════════

1. grep -n "const canonicalRoute" router.js
   → must appear exactly once

2. grep -n "const navLinks\|const sections" router.js
   → each must appear exactly once

3. node --check router.js 2>&1
   → must say nothing (no syntax errors)

4. python3 -c "import json; json.load(open('tools-manifest.json'))"
   → must not raise exception

5. grep -n "bar.href" shared/vd-nav-fix.js
   → must NOT contain href = '/'

6. grep -n "example.supabase.co\|replace-with-anon-key" tools/eco-engine-test/index.html
   → must return nothing

7. grep -n "!important" tools/games/*/index.html | grep -i "transform\|opacity"
   → must return nothing

8. for each modified HTML file: check opening/closing <script> tags balance

════════════════════════════════════════════
OUTPUT FORMAT FOR ALL TASKS
════════════════════════════════════════════

After every task, output:

  | File | Change | Lines affected | Verified |
  |------|--------|----------------|----------|

Then list any file you SKIPPED and why.
Then list any check from the checklist above that failed.

If a check fails: fix it before declaring the task done.
Never output "done" if a syntax check fails.

════════════════════════════════════════════
WHEN IN DOUBT
════════════════════════════════════════════

Ask before acting. A clarifying question is better than a broken game.
