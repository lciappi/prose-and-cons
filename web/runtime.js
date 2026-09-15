import { cleanText, MAX_TEXT } from './text.js';

const voices = new Map([
  ['af_heart', 'Heart'], ['af_bella', 'Bella'], ['af_nicole', 'Nicole'],
  ['am_michael', 'Michael'], ['am_fenrir', 'Fenrir'], ['bf_emma', 'Emma'],
  ['bf_isabella', 'Isabella'], ['bm_george', 'George'],
]);

export class BrowserRuntime {
  constructor({ createWorker = () => new Worker(new URL('./speech.worker.js', import.meta.url), { type: 'module' }) } = {}) {
    this.createWorker = createWorker;
    this.jobs = new Map();
    this.worker = null;
    this.active = null;
  }

  async api(path, options = {}) {
    if (path === '/api/status') return { ready: true };
    if (path === '/api/extract') {
      const { extractPDF } = await import('./pdf.js');
      return extractPDF(options.body.get('file'), options.body.get('layout'));
    }
    if (path === '/api/jobs') return this.start(JSON.parse(options.body));
    const match = path.match(/^\/api\/jobs\/([a-f0-9]{32})(\/cancel)?$/);
    const job = match && this.jobs.get(match[1]);
    if (!job) throw new Error('This session has ended. Generate the narration again and download it before leaving this tab.');
    if (match[2] && this.active === job.id) {
      // Terminating the worker also interrupts model downloads and WASM inference.
      this.worker.terminate();
      this.worker = null;
      this.active = null;
      Object.assign(job, { status: 'cancelled', message: 'Narration cancelled.' });
    }
    return job;
  }

  start(data) {
    if (this.active) throw new Error('A narration is already running. Wait for it or cancel it first.');
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Add some article text first.');
    if (data.text.length > MAX_TEXT) throw new Error('Use up to 150,000 characters per article.');
    const text = cleanText(data.text);
    if (!/[\p{L}\p{N}]/u.test(text)) throw new Error('Add readable words to narrate.');
    if (!voices.has(data.voice)) throw new Error('Choose one of the available voices.');
    if (!Number.isFinite(data.speed) || data.speed < 0.75 || data.speed > 1.5) throw new Error('Speed must be between 0.75 and 1.5.');
    const id = crypto.randomUUID().replaceAll('-', '');
    const job = { id, preview: Boolean(data.preview), title: String(data.title || 'My article').slice(0, 160), voice: voices.get(data.voice), status: 'running', progress: 0, message: 'Loading voice model… First use downloads about 90 MB.' };
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = ({ data: message }) => this.receive(message);
      this.worker.onerror = event => {
        event.preventDefault();
        this.receive({ id: this.active, status: 'error', message: 'Speech could not start. Try again in an up-to-date browser.' });
      };
    }
    for (const [oldId, oldJob] of this.jobs) {
      if (oldJob.status !== 'done') this.jobs.delete(oldId);
    }
    this.jobs.set(id, job);
    this.active = id;
    this.worker.postMessage({ id, text, voice: data.voice, speed: data.speed });
    return { id };
  }

  receive(message) {
    if (message.id !== this.active) return;
    const job = this.jobs.get(message.id);
    if (!job) return;
    if (message.status === 'done') {
      // Retain the latest article while trying voices, and release replaced audio.
      for (const [oldId, oldJob] of this.jobs) {
        if (oldId !== job.id && oldJob.preview === job.preview) {
          for (const url of Object.values(oldJob.urls || {})) URL.revokeObjectURL(url);
          this.jobs.delete(oldId);
        }
      }
      job.urls = Object.fromEntries(Object.entries(message.audio).map(([format, blob]) => [format, URL.createObjectURL(blob)]));
      job.formats = Object.keys(job.urls);
      job.duration = message.duration;
      this.active = null;
    } else if (message.status === 'error') {
      this.active = null;
      this.worker.terminate();
      this.worker = null;
    }
    Object.assign(job, { status: message.status || 'running', progress: message.progress ?? job.progress, message: message.message });
  }

  audioURL(id, format) {
    return this.jobs.get(id)?.urls?.[format];
  }
}
