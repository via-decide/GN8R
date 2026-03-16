/**
 * file-exporter.js — Telegram file and message sending
 */

import { existsSync, unlinkSync } from 'fs';
import { chunksForTelegram } from './task-parser.js';

export function makeTelegramAPI(token) {
  const BASE = `https://api.telegram.org/bot${token}`;

  async function request(method, body) {
    const res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      // On parse error, retry without Markdown
      if (text.includes("can't parse entities") && body.parse_mode) {
        const plain = { ...body }; delete plain.parse_mode;
        return request(method, plain);
      }
      throw new Error(`Telegram ${method} ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method} returned ok=false`);
    return data.result;
  }


  async function sendMessageChunked(chatId, text, extra = {}) {
    const chunks = chunksForTelegram(text);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const isFirstChunk = i === 0;
      const payload = {
        chat_id: chatId,
        text: chunks[i],
        disable_web_page_preview: true,
        ...(isFirstChunk ? extra : {}),
      };

      try {
        results.push(await request('sendMessage', { parse_mode: 'Markdown', ...payload }));
      } catch {
        // Fallback: strip markdown if Telegram rejects formatting entities.
        results.push(await request('sendMessage', {
          ...payload,
          text: chunks[i].replace(/[*_`\[\]]/g, ''),
        }));
      }
    }

    return results;
  }

  return {
    async sendMessage(chatId, text, extra = {}) {
      return sendMessageChunked(chatId, text, extra);
    },

    async sendDocument(chatId, filepath, filename, caption) {
      const { FormData } = await import('formdata-node');
      const { fileFromPath } = await import('formdata-node/file-from-path');
      const form = new FormData();
      form.set('chat_id', String(chatId));
      if (caption) { form.set('caption', caption.slice(0, 1024)); form.set('parse_mode', 'Markdown'); }
      form.set('document', await fileFromPath(filepath, filename));

      const res = await fetch(`${BASE}/sendDocument`, { method: 'POST', body: form });
      if (!res.ok) { const t = await res.text(); throw new Error(`sendDocument ${res.status}: ${t}`); }
      const data = await res.json();
      if (!data.ok) throw new Error('sendDocument returned ok=false');
      return data.result;
    },

    async sendPreviewCard(chatId, { text, buttons }) {
      return sendMessageChunked(chatId, text, { reply_markup: { inline_keyboard: buttons } });
    },

    async answerCallbackQuery(callbackQueryId, text) {
      return request('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || 'OK' });
    },

    async setMyCommands(commands) {
      return request('setMyCommands', { commands });
    },

    async getMe() {
      const res = await fetch(`${BASE}/getMe`);
      const data = await res.json();
      return data.result;
    },
  };
}

export function formatFileCaption(plan, artifact) {
  const kb = ((artifact.size || 0) / 1024).toFixed(1);
  return [`✅ *Task complete*`, ``, `📄 \`${artifact.filename}\``, `📦 ${kb} KB | ${(plan.outputType || 'file').toUpperCase()}`, ``, `_Antigravity • Decide Engine Bot_`].join('\n');
}
