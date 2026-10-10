// Automated backend tests. They use a MOCK Ollama server, so they do not need
// Ollama or any model installed. They do NOT prove real model quality.
// Run from the server folder:  npm test

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let mock;
let api;
let apiServer;
let apiBase;
let mockState = { installed: ['qwen3:4b', 'qwen2.5-coder:1.5b'], chatDelayMs: 0, lastChatBody: null };

function startMock() {
  return new Promise((resolve) => {
    mock = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ models: mockState.installed.map((name) => ({ name })) }));
      }
      if (req.url === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          mockState.lastChatBody = JSON.parse(body);
          setTimeout(() => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: { role: 'assistant', content: '<think>hidden</think>Mock answer' } }));
          }, mockState.chatDelayMs);
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    mock.listen(0, '127.0.0.1', () => resolve(mock.address().port));
  });
}

before(async () => {
  const mockPort = await startMock();
  process.env.OLLAMA_URL = `http://127.0.0.1:${mockPort}`;
  process.env.NODE_ENV = 'test';
  process.env.STUDY_TIMEOUT_MS = '500';
  const mod = await import('../server/server.js');
  apiServer = await new Promise((resolve) => {
    const s = mod.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  apiBase = `http://127.0.0.1:${apiServer.address().port}`;
});

after(() => {
  apiServer?.close();
  mock?.close();
});

const post = (body) =>
  fetch(`${apiBase}/api/study`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid = { action: 'ask', notes: 'Normalization reduces redundancy.', question: 'What is it?', model: 'qwen3:4b' };

test('health reports Ollama and installed models', async () => {
  const r = await fetch(`${apiBase}/api/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ollama, true);
  assert.deepEqual(j.models, ['qwen3:4b', 'qwen2.5-coder:1.5b']);
});

test('ask returns answer, model name, and strips <think> blocks', async () => {
  const r = await post(valid);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.answer, 'Mock answer');
  assert.equal(j.model, 'qwen3:4b');
  assert.equal(mockState.lastChatBody.stream, false);
  assert.equal(mockState.lastChatBody.think, false); // qwen3 only
});

test('summarize and quiz work without a question', async () => {
  for (const action of ['summarize', 'quiz']) {
    const r = await post({ ...valid, action, question: '' });
    assert.equal(r.status, 200, action);
  }
});

test('non-qwen3 model does not receive the think flag', async () => {
  const r = await post({ ...valid, model: 'qwen2.5-coder:1.5b' });
  assert.equal(r.status, 200);
  assert.equal('think' in mockState.lastChatBody, false);
});

test('rejects invalid action (400)', async () => {
  const r = await post({ ...valid, action: 'hack' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'INVALID_ACTION');
});

test('rejects arbitrary model names (400)', async () => {
  const r = await post({ ...valid, model: 'llama3:70b' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'INVALID_MODEL');
});

test('rejects empty notes (400)', async () => {
  const r = await post({ ...valid, notes: '   ' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'EMPTY_NOTES');
});

test('ask without a question is rejected (400)', async () => {
  const r = await post({ ...valid, question: '' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'EMPTY_QUESTION');
});

test('oversized notes rejected (413)', async () => {
  const r = await post({ ...valid, notes: 'a'.repeat(12_001) });
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error.code, 'NOTES_TOO_LONG');
});

test('oversized request body rejected (413)', async () => {
  const r = await post({ ...valid, notes: 'a'.repeat(200_000) });
  assert.equal(r.status, 413);
});

test('malformed JSON rejected (400)', async () => {
  const r = await post('{not json');
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'BAD_JSON');
});

test('allowed model that is not installed gives actionable 404', async () => {
  const r = await post({ ...valid, model: 'gemma4:e2b' });
  const j = await r.json();
  assert.equal(r.status, 404);
  assert.equal(j.error.code, 'MODEL_NOT_INSTALLED');
  assert.match(j.error.message, /ollama list/);
});

test('slow model triggers timeout (504) instead of hanging', async () => {
  mockState.chatDelayMs = 1500; // server timeout is 500 ms in tests
  const r = await post(valid);
  mockState.chatDelayMs = 0;
  assert.equal(r.status, 504);
  assert.equal((await r.json()).error.code, 'TIMEOUT');
});

test('unknown API route returns JSON 404', async () => {
  const r = await fetch(`${apiBase}/api/nope`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).ok, false);
});

test('Ollama down: health 503 and study 503', async () => {
  const savedUrl = process.env.OLLAMA_URL;
  // Close mock, then both endpoints must fail gracefully.
  await new Promise((resolve) => mock.close(resolve));
  const h = await fetch(`${apiBase}/api/health`);
  assert.equal(h.status, 503);
  assert.equal((await h.json()).ollama, false);
  const s = await post(valid);
  assert.equal(s.status, 503);
  assert.equal((await s.json()).error.code, 'OLLAMA_UNAVAILABLE');
  process.env.OLLAMA_URL = savedUrl;
});
