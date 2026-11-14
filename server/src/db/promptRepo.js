/**
 * P0.2: Prompt repository — CRUD for the prompts table.
 */
import { getDb } from './init.js';

export function getAllPrompts() {
  const db = getDb();
  return db.prepare('SELECT * FROM prompts ORDER BY type, created_at').all();
}

export function getPromptById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
}

export function getPromptsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM prompts WHERE id IN (${placeholders})`).all(...ids);
}

export function getSystemPrompt(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM prompts WHERE id = ? AND type = 'system'").get(id);
}

export function getDefaultSystemPrompt() {
  const db = getDb();
  const row = db.prepare("SELECT * FROM prompts WHERE type = 'system' AND is_default = 1 LIMIT 1").get();
  return row || null;
}

export function createPrompt({ name, type, content, is_default = 0 }) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO prompts (id, name, type, content, is_default) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, type, content, is_default);
  return getPromptById(id);
}

export function updatePrompt(id, { name, type, content, is_default }) {
  const db = getDb();
  const existing = getPromptById(id);
  if (!existing) return null;

  // Guard: cannot remove is_default from the last default system prompt
  if (existing.type === 'system' && existing.is_default === 1 && is_default === 0) {
    const otherDefaults = db.prepare(
      "SELECT COUNT(*) AS c FROM prompts WHERE type = 'system' AND is_default = 1 AND id != ?"
    ).get(id).c;
    if (otherDefaults === 0) {
      throw new Error('Cannot remove is_default from the last default system prompt');
    }
  }

  db.prepare(
    'UPDATE prompts SET name = ?, type = ?, content = ?, is_default = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(name ?? existing.name, type ?? existing.type, content ?? existing.content, is_default ?? existing.is_default, id);
  return getPromptById(id);
}

export function deletePrompt(id) {
  const db = getDb();
  const existing = getPromptById(id);
  if (!existing) return false;

  // Guard: cannot delete the last default system prompt
  if (existing.type === 'system' && existing.is_default === 1) {
    const otherDefaults = db.prepare(
      "SELECT COUNT(*) AS c FROM prompts WHERE type = 'system' AND is_default = 1 AND id != ?"
    ).get(id).c;
    if (otherDefaults === 0) {
      throw new Error('Cannot delete the last default system prompt');
    }
  }

  const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  return result.changes > 0;
}
