import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenerationParams, GENERATION_PARAM_KEYS } from '../../src/utils/generationParams.js';

/**
 * ТЗ P0.1 §6.1: unit-тесты parseGenerationParams (11 кейсов).
 */
describe('parseGenerationParams (P0.1)', () => {
    it('1. пустой объект → ok, params = {}', () => {
        const r = parseGenerationParams({});
        assert.equal(r.ok, true);
        assert.deepEqual(r.params, {});
    });

    it('2. undefined → ok, params = {}', () => {
        const r = parseGenerationParams(undefined);
        assert.equal(r.ok, true);
        assert.deepEqual(r.params, {});
    });

    it('3. все поля пустые строки → ok, params = {}', () => {
        const r = parseGenerationParams({
            temperature: '', top_p: '', top_k: '', min_p: '',
            n_predict: '', presence_penalty: '', repeat_penalty: ''
        });
        assert.equal(r.ok, true);
        assert.deepEqual(r.params, {});
    });

    it('4. валидные строковые значения (FormData) → ok, коэрция в number', () => {
        const r = parseGenerationParams({
            temperature: '0.5', top_p: '0.9', top_k: '40',
            min_p: '0.1', n_predict: '2048',
            presence_penalty: '0.5', repeat_penalty: '1.1'
        });
        assert.equal(r.ok, true);
        assert.deepEqual(r.params, {
            temperature: 0.5, top_p: 0.9, top_k: 40,
            min_p: 0.1, n_predict: 2048,
            presence_penalty: 0.5, repeat_penalty: 1.1
        });
    });

    it('5. temperature = "abc" → 400, field=temperature', () => {
        const r = parseGenerationParams({ temperature: 'abc' });
        assert.equal(r.ok, false);
        assert.equal(r.error.field, 'temperature');
        assert.match(r.error.message, /temperature must be a number between 0 and 2/);
    });

    it('6. temperature = "5" → 400, min=0, max=2', () => {
        const r = parseGenerationParams({ temperature: '5' });
        assert.equal(r.ok, false);
        assert.equal(r.error.field, 'temperature');
        assert.equal(r.error.min, 0);
        assert.equal(r.error.max, 2);
    });

    it('7. top_k = "40.5" → 400 (integer)', () => {
        const r = parseGenerationParams({ top_k: '40.5' });
        assert.equal(r.ok, false);
        assert.equal(r.error.field, 'top_k');
        assert.match(r.error.message, /must be an integer/);
    });

    it('8. n_predict = "0" → 400 (disallowZero)', () => {
        const r = parseGenerationParams({ n_predict: '0' });
        assert.equal(r.ok, false);
        assert.equal(r.error.field, 'n_predict');
        assert.match(r.error.message, /0 is not allowed/);
    });

    it('9. n_predict = "-1" → ok (до остановки по контексту)', () => {
        const r = parseGenerationParams({ n_predict: '-1' });
        assert.equal(r.ok, true);
        assert.equal(r.params.n_predict, -1);
    });

    it('10. top_p = "1.5" → 400 (max=1)', () => {
        const r = parseGenerationParams({ top_p: '1.5' });
        assert.equal(r.ok, false);
        assert.equal(r.error.field, 'top_p');
        assert.equal(r.error.max, 1);
    });

    it('11. unknown keys игнорируются', () => {
        const r = parseGenerationParams({
            temperature: '0.5',
            unknown_param: '999',
            another_unknown: 'abc'
        });
        assert.equal(r.ok, true);
        assert.deepEqual(r.params, { temperature: 0.5 });
    });

    it('доп: все 7 ключей валидны одновременно → ok', () => {
        const r = parseGenerationParams({
            temperature: '1.0', top_p: '0.95', top_k: '50',
            min_p: '0.05', n_predict: '4096',
            presence_penalty: '0.0', repeat_penalty: '1.05'
        });
        assert.equal(r.ok, true);
        assert.equal(Object.keys(r.params).length, 7);
    });

    it('доп: GENERATION_PARAM_KEYS содержит ровно 7 ключей', () => {
        assert.equal(GENERATION_PARAM_KEYS.length, 7);
        for (const key of ['temperature', 'top_p', 'top_k', 'min_p', 'n_predict', 'presence_penalty', 'repeat_penalty']) {
            assert.ok(GENERATION_PARAM_KEYS.includes(key));
        }
    });
});
