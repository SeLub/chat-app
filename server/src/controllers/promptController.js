/**
 * P0.2: Prompt controller — REST API handlers for /api/prompts.
 */
import * as promptRepo from '../db/promptRepo.js';

export function listPrompts(req, res) {
  try {
    const prompts = promptRepo.getAllPrompts();
    res.json(prompts);
  } catch (e) {
    console.error('[promptController] listPrompts:', e);
    res.status(500).json({ error: 'Failed to list prompts' });
  }
}

export function getPrompt(req, res) {
  try {
    const prompt = promptRepo.getPromptById(req.params.id);
    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json(prompt);
  } catch (e) {
    console.error('[promptController] getPrompt:', e);
    res.status(500).json({ error: 'Failed to get prompt' });
  }
}

export function createPrompt(req, res) {
  try {
    const { name, type, content, is_default } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (type !== 'system' && type !== 'user_template') {
      return res.status(400).json({ error: "type must be 'system' or 'user_template'" });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const prompt = promptRepo.createPrompt({
      name: name.trim(),
      type,
      content: content.trim(),
      is_default: is_default ? 1 : 0,
    });
    res.status(201).json(prompt);
  } catch (e) {
    console.error('[promptController] createPrompt:', e);
    res.status(500).json({ error: 'Failed to create prompt' });
  }
}

export function updatePrompt(req, res) {
  try {
    const { name, type, content, is_default } = req.body;

    if (type !== undefined && type !== 'system' && type !== 'user_template') {
      return res.status(400).json({ error: "type must be 'system' or 'user_template'" });
    }
    if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    if (content !== undefined && (!content || typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ error: 'content cannot be empty' });
    }

    const prompt = promptRepo.updatePrompt(req.params.id, { name, type, content, is_default });
    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json(prompt);
  } catch (e) {
    if (e.message.includes('Cannot remove is_default') || e.message.includes('Cannot delete')) {
      return res.status(400).json({ error: e.message });
    }
    console.error('[promptController] updatePrompt:', e);
    res.status(500).json({ error: 'Failed to update prompt' });
  }
}

export function deletePrompt(req, res) {
  try {
    const deleted = promptRepo.deletePrompt(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('Cannot delete')) {
      return res.status(400).json({ error: e.message });
    }
    console.error('[promptController] deletePrompt:', e);
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
}
