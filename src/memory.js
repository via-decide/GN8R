/**
 * src/memory.js
 * Per-user key/value memory store for context injection.
 */

export class MemoryManager {
  constructor(stateEngine) {
    this.se = stateEngine;
  }

  /**
   * Store a fact: /remember I prefer TypeScript over JavaScript
   * @param {string|number} chatId
   * @param {string} key
   * @param {string} value
   */
  async set(chatId, key, value) {
    await this.se.upsertMemory(chatId, (memory) => {
      memory[key.toLowerCase()] = { value, updatedAt: new Date().toISOString() };
      return memory;
    });
  }

  /**
   * Recall a specific key or all memory
   * @param {string|number} chatId
   * @param {string} [key]
   */
  async get(chatId, key = null) {
    const memory = await this.se.getMemory(chatId);
    if (key) return memory[key.toLowerCase()];
    return memory;
  }

  /**
   * Delete a key: /forget language
   * @param {string|number} chatId
   * @param {string} key
   */
  async delete(chatId, key) {
    await this.se.upsertMemory(chatId, (memory) => {
      if (key === 'all') {
        return {};
      }
      delete memory[key.toLowerCase()];
      return memory;
    });
  }

  /**
   * Format all memory for display in Telegram
   * @param {string|number} chatId
   */
  async format(chatId) {
    const memory = await this.se.getMemory(chatId);
    const keys = Object.keys(memory);
    if (keys.length === 0) return '🧠 No facts remembered yet. Use /remember <key>: <value>';

    const lines = [`📌 Memory (${keys.length} facts):`];
    for (const [key, data] of Object.entries(memory)) {
      lines.push(`• ${key}: ${data.value}`);
    }
    return lines.join('\n');
  }

  /**
   * Inject relevant memory as context prefix for Antigravity prompts
   * @param {string|number} chatId
   */
  async buildContext(chatId) {
    const memory = await this.se.getMemory(chatId);
    const keys = Object.keys(memory);
    if (keys.length === 0) return '';

    const lines = ['User Preferences & Context:'];
    for (const [key, data] of Object.entries(memory)) {
      lines.push(`- ${key}: ${data.value}`);
    }
    return lines.join('\n');
  }

  /**
   * Auto-extract key from freeform text
   * @param {string} text
   */
  extractKey(text) {
    if (text.includes(':')) {
      const parts = text.split(':');
      const key = parts[0].trim();
      const value = parts.slice(1).join(':').trim();
      return { key, value };
    }
    const words = text.trim().split(/\s+/);
    const key = words.slice(0, 3).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
    return { key, value: text.trim() };
  }
}
