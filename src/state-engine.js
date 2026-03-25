/**
 * state-engine.js
 * File-based state with write lock + corrupt recovery.
 * Ported from Simba's SimbaStateEngine and extended for user tasks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const TaskStatus = {
  PENDING: 'pending', PLANNING: 'planning', AUDITING: 'auditing',
  GENERATING: 'generating', BUILDING: 'building', DONE: 'done',
  FAILED: 'failed', CANCELLED: 'cancelled', RUNNING: 'running',
};

export class StateEngine {
  constructor(stateFilePath, maxHistory = 50) {
    this.stateFilePath = stateFilePath;
    this.maxHistory = maxHistory;
    this._writeLock = Promise.resolve();
  }

  static fromConfig(config) {
    const stateFilePath = path.join(config.artifactsDir, 'bot-state.json');
    return new StateEngine(stateFilePath, config.maxTaskHistory);
  }

  _withLock(fn) {
    this._writeLock = this._writeLock.then(fn, fn);
    return this._writeLock;
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.stateFilePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return { chats: {} };
      console.error('[state] Corrupt state file, resetting:', err.message);
      try {
        const backup = this.stateFilePath + '.corrupt-' + Date.now();
        await fs.rename(this.stateFilePath, backup).catch(() => {});
      } catch {}
      return { chats: {} };
    }
  }

  async _save(state) {
    await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    const tmp = this.stateFilePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, this.stateFilePath);
  }

  async upsertChatState(chatId, updater) {
    return this._withLock(async () => {
      const state = await this._load();
      const key = String(chatId);
      const current = state.chats[key] || {
        tasks: {}, activeTaskId: null, pendingPreview: null,
        logs: [], taskQueue: { pending: [], completed: [], failed: [] }
      };
      state.chats[key] = updater(current);

      // Prune old tasks
      const tasks = state.chats[key].tasks;
      const taskIds = Object.keys(tasks);
      if (taskIds.length > this.maxHistory) {
        const sorted = taskIds.sort((a, b) =>
          (tasks[a].timestamps?.startedAt || '') < (tasks[b].timestamps?.startedAt || '') ? -1 : 1
        );
        sorted.slice(0, taskIds.length - this.maxHistory).forEach(id => delete tasks[id]);
      }

      await this._save(state);
      return state.chats[key];
    });
  }

  async getChatState(chatId) {
    const state = await this._load();
    return state.chats[String(chatId)] || {
      tasks: {}, activeTaskId: null, pendingPreview: null,
      logs: [], taskQueue: { pending: [], completed: [], failed: [] }
    };
  }

  async setTaskState(chatId, taskId, updates) {
    return this.upsertChatState(chatId, chat => {
      const existing = chat.tasks[taskId] || {};
      chat.tasks[taskId] = { ...existing, ...updates,
        taskId, timestamps: { ...existing.timestamps, ...updates.timestamps }
      };
      if (updates.status === TaskStatus.RUNNING || updates.currentStage === 'PLAN') {
        chat.activeTaskId = taskId;
      }
      if ([TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(updates.status)) {
        if (chat.activeTaskId === taskId) chat.activeTaskId = null;
      }
      return chat;
    });
  }

  async getTask(chatId, taskId) {
    const chat = await this.getChatState(chatId);
    return chat.tasks[taskId] || null;
  }

  async getActiveTask(chatId) {
    const chat = await this.getChatState(chatId);
    if (!chat.activeTaskId) return null;
    return chat.tasks[chat.activeTaskId] || null;
  }

  async getTaskHistory(chatId, limit = 10) {
    const chat = await this.getChatState(chatId);
    return Object.values(chat.tasks)
      .sort((a, b) => (b.timestamps?.startedAt || '') > (a.timestamps?.startedAt || '') ? 1 : -1)
      .slice(0, limit);
  }

  async cancelActiveTask(chatId) {
    const chat = await this.getChatState(chatId);
    if (!chat.activeTaskId) return null;
    const taskId = chat.activeTaskId;
    await this.setTaskState(chatId, taskId, {
      status: TaskStatus.CANCELLED,
      timestamps: { updatedAt: new Date().toISOString() }
    });
    return taskId;
  }

  async appendLog(chatId, entry) {
    return this.upsertChatState(chatId, chat => {
      chat.logs = chat.logs || [];
      chat.logs.push({ ts: new Date().toISOString(), ...entry });
      if (chat.logs.length > 200) chat.logs = chat.logs.slice(-200);
      return chat;
    });
  }

  async getLogs(chatId, limit = 20) {
    const chat = await this.getChatState(chatId);
    return (chat.logs || []).slice(-limit);
  }

  async setPendingPreview(chatId, preview) {
    return this.upsertChatState(chatId, chat => ({ ...chat, pendingPreview: preview }));
  }

  async clearPendingPreview(chatId) {
    return this.upsertChatState(chatId, chat => ({ ...chat, pendingPreview: null }));
  }

  // ── Task queue ──────────────────────────────────────────────

  async getTaskQueue(chatId) {
    const chat = await this.getChatState(chatId);
    return chat.taskQueue || { pending: [], completed: [], failed: [] };
  }

  async addToQueue(chatId, task) {
    return this.upsertChatState(chatId, chat => {
      chat.taskQueue = chat.taskQueue || { pending: [], completed: [], failed: [] };
      chat.taskQueue.pending.push(task);
      return chat;
    });
  }

  async markQueueTask(chatId, toolId, status, extra = {}) {
    return this.upsertChatState(chatId, chat => {
      chat.taskQueue = chat.taskQueue || { pending: [], completed: [], failed: [] };
      const idx = chat.taskQueue.pending.findIndex(t => t.toolId === toolId || t.taskId === toolId);
      const task = idx >= 0 ? chat.taskQueue.pending.splice(idx, 1)[0] : { toolId };
      const target = status === 'completed' ? chat.taskQueue.completed : chat.taskQueue.failed;
      target.push({ ...task, ...extra, completedAt: new Date().toISOString() });
      return chat;
    });
  }

  async clearTaskQueue(chatId) {
    return this.upsertChatState(chatId, chat => ({
      ...chat, taskQueue: { pending: [], completed: [], failed: [] }
    }));
  }
}
