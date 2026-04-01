# Implementation Plan: Operation Beast-Mode

Execute 'Operation Beast-Mode' to transform GN8R into a unified, high-performance Synthesis Orchestrator.

## 1. Multi-Modal Sensor Array (The Sensor Array)
- **Problem**: Currently, the bot only listens for text updates.
- **Solution**: Refactor `telegram-bot.js` to detect and capture `photo`, `voice`, and `audio`.
- **Logic**:
    - If a user sends a photo + text, or a voice note + photo, the `CommandRouter` must receive all of them.
    - Vision (images) and Vox (audio/voice) will be passed to Gemini.

## 2. Recursive Self-Awareness (The Beast Brain)
- **Problem**: The bot doesn't know its own recent capabilities.
- **Solution**: Implement `fetchSelfHistory()` (Synapse Engine) to read the latest 15 commits for `via-decide/GN8R`.
- **Logic**:
    - This history will be injected into the system prompt so the bot "knows" it can call the PR Controller, Context Fetcher, etc.

## 3. Antigravity Global Planner (The Flight Plan)
- **Problem**: Tasks start without clearly stating the "data flight plan".
- **Solution**: Prefix كل task with a 'Global Flight Plan'.
- **Format**:
    - "Using Vision data from image... Using Context from repo/file... Executing via Gemini 1.5 Pro."

## 4. Zero-Friction Merge Loop (The Commander UI)
- **Problem**: Users have to manually manage output quality and merging.
- **Solution**: Include 'Merge/Tweak/Close' buttons in every response.
- **Metric**: Add 'Token Efficiency Report' and 'Success Confidence' score.

## 5. Performance Optimization (Gemini Split)
- **Problem**: Pro models are slower for planning; Flash models are less precise for synthesis.
- **Solution**:
    - Use **Gemini 1.5 Flash** for initial "Intent Deconstruction".
    - Use **Gemini 1.5 Pro** for "Final Synthesis" (code generation).

## Summary: The Antigravity Apex Engine
- **Goal**: Autonomous, multimodal software engineer.
- **Branch**: `Evolution: GN8R Beast-Mode Core`
- **Commit**: `feat: unify vision, vox, synapse, and commander into the Antigravity Apex Engine`
- **PR Title**: `Evolution: GN8R Beast-Mode Core`
