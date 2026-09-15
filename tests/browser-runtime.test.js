import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserRuntime } from '../web/runtime.js';
import { cleanText, splitText } from '../web/text.js';
import { pcm16, wavBlob } from '../web/audio.js';

test('text cleanup and passage splitting preserve words within model limits', () => {
  assert.equal(cleanText('A beau-\ntiful story\ncontinues.\n\nNext part.'), 'A beautiful story continues.\n\nNext part.');
  const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
  const parts = splitText(text);
  assert.equal(parts.join(' '), text);
  assert.ok(parts.every(part => part.length <= 450));
  assert.equal(splitText('a'.repeat(2000)).join(''), 'a'.repeat(2000));
});

test('WAV header matches PCM samples and clips to the 16-bit range', async () => {
  const pcm = pcm16(new Float32Array([-2, -1, 0, 1, 2]));
  assert.deepEqual([...pcm], [-32768, -32768, 0, 32767, 32767]);
  const buffer = await wavBlob([pcm], pcm.length).arrayBuffer();
  assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), 'RIFF');
  const view = new DataView(buffer);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(buffer.byteLength, 54);
});

function setup() {
  const workers = [];
  const runtime = new BrowserRuntime({ createWorker: () => {
    const worker = { postMessage(message) { this.sent = message; }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  } });
  const start = () => runtime.api('/api/jobs', { body: JSON.stringify({ text: 'Hello world.', voice: 'af_heart', speed: 1, title: 'Article' }) });
  return { runtime, workers, start };
}

test('browser jobs report progress, expose audio, and survive without any server', async () => {
  const { runtime, workers, start } = setup();
  const { id } = await start();
  assert.match(id, /^[a-f0-9]{32}$/);
  await assert.rejects(start, /already running/);
  workers[0].onmessage({ data: { id, message: 'Narrating passage 1', progress: 50 } });
  assert.equal((await runtime.api(`/api/jobs/${id}`)).progress, 50);
  workers[0].onmessage({ data: { id, status: 'done', progress: 100, duration: 1, audio: { wav: new Blob(['audio']) } } });
  assert.equal((await runtime.api(`/api/jobs/${id}`)).status, 'done');
  const url = runtime.audioURL(id, 'wav');
  assert.equal(await (await fetch(url)).text(), 'audio');
  URL.revokeObjectURL(url);
});

test('cancel terminates inference and ignores late messages; retry gets a new worker', async () => {
  const { runtime, workers, start } = setup();
  const { id } = await start();
  await runtime.api(`/api/jobs/${id}/cancel`);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { id, status: 'done', audio: {} } });
  assert.equal((await runtime.api(`/api/jobs/${id}`)).status, 'cancelled');
  await start();
  assert.equal(workers.length, 2);
});

test('worker failure unlocks generation and missing sessions give an actionable error', async () => {
  const { runtime, workers, start } = setup();
  const { id } = await start();
  workers[0].onerror({ preventDefault() {} });
  assert.equal((await runtime.api(`/api/jobs/${id}`)).status, 'error');
  await start();
  assert.equal(workers.length, 2);
  await assert.rejects(runtime.api('/api/jobs/' + 'a'.repeat(32)), /This session has ended/);
});

test('repeated previews retain the article download and release replaced previews', async () => {
  const { runtime, workers, start } = setup();
  const { id: article } = await start();
  const finish = id => workers[0].onmessage({ data: { id, status: 'done', audio: { wav: new Blob(['audio']) } } });
  finish(article);
  const articleURL = runtime.audioURL(article, 'wav');
  let previousURL;
  for (let i = 0; i < 5; i++) {
    const { id } = runtime.start({ text: 'Preview.', voice: 'af_heart', speed: 1, preview: true });
    finish(id);
    if (previousURL) await assert.rejects(fetch(previousURL));
    previousURL = runtime.audioURL(id, 'wav');
  }
  assert.equal(await (await fetch(articleURL)).text(), 'audio');
  assert.equal(runtime.jobs.size, 2);
  URL.revokeObjectURL(articleURL);
  URL.revokeObjectURL(previousURL);
});
