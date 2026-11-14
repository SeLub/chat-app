import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LlamaCppProvider } from '../src/providers/LlamaCppProvider.js';
import { OllamaProvider } from '../src/providers/OllamaProvider.js';

/**
 * ТЗ P0.1 §6.2: интеграционные тесты — generation params попадают в
 * body-запрос к провайдеру (локальный HTTP-сервер-захватчик, без реального
 * llama-server/Ollama).
 */

function startCaptureServer() {
    const requests = [];
    const server = http.createServer((req, res) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            requests.push({ url: req.url, body: data });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1 }
            }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, requests, url: `http://127.0.0.1:${port}` });
        });
    });
}

async function withCaptureServer(fn) {
    const capture = await startCaptureServer();
    try {
        await fn(capture);
    } finally {
        capture.server.close();
    }
}

describe('LlamaCppProvider.chat — generationParams (P0.1)', () => {
    it('1. без generationParams → body БЕЗ temperature и БЕЗ max_tokens', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new LlamaCppProvider('llama', { url });
            await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }], stream: false });

            const body = JSON.parse(requests[0].body);
            assert.equal(body.temperature, undefined, 'temperature не шлётся (server default)');
            assert.equal(body.max_tokens, undefined, 'max_tokens не шлётся (server default)');
            assert.equal(body.top_p, undefined);
            assert.equal(body.top_k, undefined);
        });
    });

    it('2. generationParams = { temperature: 0.5, top_p: 0.9 } → body содержит оба', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new LlamaCppProvider('llama', { url });
            await provider.chat({
                model: 'test',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                generationParams: { temperature: 0.5, top_p: 0.9 }
            });

            const body = JSON.parse(requests[0].body);
            assert.equal(body.temperature, 0.5);
            assert.equal(body.top_p, 0.9);
            assert.equal(body.max_tokens, undefined);
        });
    });

    it('3. generationParams.n_predict = 2048 → body.max_tokens = 2048', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new LlamaCppProvider('llama', { url });
            await provider.chat({
                model: 'test',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                generationParams: { n_predict: 2048 }
            });

            const body = JSON.parse(requests[0].body);
            assert.equal(body.max_tokens, 2048);
        });
    });

    it('4. generationParams.n_predict = -1 → body.max_tokens = -1 (до остановки по контексту)', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new LlamaCppProvider('llama', { url });
            await provider.chat({
                model: 'test',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                generationParams: { n_predict: -1 }
            });

            const body = JSON.parse(requests[0].body);
            assert.equal(body.max_tokens, -1);
        });
    });

    it('5. maxTokens=4096 + generationParams.n_predict=2048 → body.max_tokens = 2048 (n_predict приоритет)', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new LlamaCppProvider('llama', { url });
            await provider.chat({
                model: 'test',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                maxTokens: 4096,
                generationParams: { n_predict: 2048 }
            });

            const body = JSON.parse(requests[0].body);
            assert.equal(body.max_tokens, 2048, 'n_predict (UI) имеет приоритет над maxTokens');
        });
    });
});

describe('OllamaProvider.chat — generationParams (P0.1)', () => {
    it('6. без generationParams → body БЕЗ options', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new OllamaProvider('ollama', { url });
            await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }], stream: false });

            const body = JSON.parse(requests[0].body);
            assert.equal(body.options, undefined, 'options не шлётся (default Ollama)');
        });
    });

    it('доп: generationParams = { temperature: 0.5, n_predict: 2048 } → options = { temperature: 0.5, num_predict: 2048 }', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new OllamaProvider('ollama', { url });
            await provider.chat({
                model: 'test',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                generationParams: { temperature: 0.5, n_predict: 2048 }
            });

            const body = JSON.parse(requests[0].body);
            assert.deepEqual(body.options, { temperature: 0.5, num_predict: 2048 });
        });
    });

    it('доп: все 7 params → options содержит все (n_predict → num_predict)', async () => {
        await withCaptureServer(async ({ requests, url }) => {
            const provider = new OllamaProvider('ollama', { url });
            await provider.chat({
                model: 'test',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                generationParams: {
                    temperature: 0.2, top_p: 0.95, top_k: 40,
                    min_p: 0.05, n_predict: 4096,
                    presence_penalty: 0.0, repeat_penalty: 1.05
                }
            });

            const body = JSON.parse(requests[0].body);
            assert.deepEqual(body.options, {
                temperature: 0.2, top_p: 0.95, top_k: 40,
                min_p: 0.05, num_predict: 4096,
                presence_penalty: 0.0, repeat_penalty: 1.05
            });
        });
    });
});
