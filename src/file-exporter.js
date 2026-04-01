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

  return {
    async sendMessage(chatId, text, extra = {}) {
      const chunks = chunksForTelegram(text);
      const results = [];
      for (const chunk of chunks) {
        try {
          results.push(await request('sendMessage', {
            chat_id: chatId, text: chunk,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            ...extra,
          }));
        } catch {
          // fallback: strip markdown
          results.push(await request('sendMessage', {
            chat_id: chatId, text: chunk.replace(/[*_`\[\]]/g, ''),
            disable_web_page_preview: true,
          }));
        }
      }
      return results;
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
      return request('sendMessage', {
        chat_id: chatId, text,
        reply_markup: { inline_keyboard: buttons },
      });
    },

    async answerCallbackQuery(callbackQueryId, text) {
      return request('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || 'OK' });
    },

    async setMyCommands(commands) {
      return request('setMyCommands', { commands });
    },

    async getMe() {
      try {
        return await request('getMe', {});
      } catch (err) {
        throw new Error(`getMe failed: ${err.message}`);
      }
    },
  };
}

export function formatFileCaption(plan, artifact, metrics) {
  const kb = ((artifact.size || 0) / 1024).toFixed(1);
  const lines = [
    `✅ *Synthesis Engine Apex*`,
    ``,
    `📄 \`${artifact.filename}\``,
    `📦 ${kb} KB | ${(plan.outputType || 'file').toUpperCase()}`,
    ``,
    metrics ? `⚡ *Efficiency:* ${metrics.tokenEfficiency} | *Confidence:* ${metrics.confidence}` : '',
    metrics ? `⏱ *Duration:* ${metrics.duration}` : '',
    ``,
    `_Antigravity Synthesis Orchestrator_`
  ];
  return lines.filter(Boolean).join('\n');
}
