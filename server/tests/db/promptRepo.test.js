import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as promptRepo from '../../src/db/promptRepo.js';

describe('promptRepo (P0.2)', () => {
    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(() => {
        getDb().exec('DELETE FROM prompts');
    });

    it('createPrompt inserts and returns row', () => {
        const row = promptRepo.createPrompt({
            name: 'Test Prompt',
            type: 'user_template',
            content: 'Hello world',
        });
        assert.ok(row.id);
        assert.equal(row.name, 'Test Prompt');
        assert.equal(row.type, 'user_template');
        assert.equal(row.content, 'Hello world');
        assert.equal(row.is_default, 0);
    });

    it('getAllPrompts returns sorted by type, created_at', () => {
        promptRepo.createPrompt({ name: 'Sys A', type: 'system', content: 'A' });
        promptRepo.createPrompt({ name: 'Sys B', type: 'system', content: 'B' });
        promptRepo.createPrompt({ name: 'Tmpl A', type: 'user_template', content: 'C' });

        const all = promptRepo.getAllPrompts();
        assert.equal(all.length, 3);
        // system prompts first
        assert.equal(all[0].type, 'system');
        assert.equal(all[1].type, 'system');
        assert.equal(all[2].type, 'user_template');
    });

    it('getPromptById returns undefined for missing id', () => {
        assert.equal(promptRepo.getPromptById('nonexistent'), undefined);
    });

    it('getPromptsByIds returns only existing ids', () => {
        const a = promptRepo.createPrompt({ name: 'A', type: 'user_template', content: 'a' });
        const b = promptRepo.createPrompt({ name: 'B', type: 'user_template', content: 'b' });
        const result = promptRepo.getPromptsByIds([b.id, 'missing', a.id]);
        assert.equal(result.length, 2);
        const ids = result.map(r => r.id).sort();
        assert.deepEqual(ids, [a.id, b.id].sort());
    });

    it('getSystemPrompt returns system prompt by id', () => {
        const sys = promptRepo.createPrompt({ name: 'Sys', type: 'system', content: 'sys content' });
        assert.equal(promptRepo.getSystemPrompt(sys.id)?.content, 'sys content');
        assert.equal(promptRepo.getSystemPrompt('missing'), undefined);
    });

    it('getDefaultSystemPrompt returns is_default=1 system', () => {
        const def = promptRepo.createPrompt({ name: 'Default', type: 'system', content: 'def', is_default: 1 });
        promptRepo.createPrompt({ name: 'Other', type: 'system', content: 'other' });
        const result = promptRepo.getDefaultSystemPrompt();
        assert.equal(result?.id, def.id);
    });

    it('updatePrompt modifies name and content', () => {
        const row = promptRepo.createPrompt({ name: 'Old', type: 'user_template', content: 'old' });
        const updated = promptRepo.updatePrompt(row.id, { name: 'New', content: 'new' });
        assert.equal(updated.name, 'New');
        assert.equal(updated.content, 'new');
    });

    it('updatePrompt throws when removing is_default from last default', () => {
        const def = promptRepo.createPrompt({ name: 'Def', type: 'system', content: 'd', is_default: 1 });
        assert.throws(() => promptRepo.updatePrompt(def.id, { is_default: 0 }), /default/);
    });

    it('deletePrompt removes row and returns true', () => {
        const row = promptRepo.createPrompt({ name: 'Del', type: 'user_template', content: 'd' });
        const result = promptRepo.deletePrompt(row.id);
        assert.equal(result, true);
        assert.equal(promptRepo.getPromptById(row.id), undefined);
    });

    it('deletePrompt throws for last default system prompt', () => {
        const def = promptRepo.createPrompt({ name: 'Def', type: 'system', content: 'd', is_default: 1 });
        assert.throws(() => promptRepo.deletePrompt(def.id), /default/);
    });
});
