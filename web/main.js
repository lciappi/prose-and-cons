import { BrowserRuntime } from './runtime.js';

window.folioRuntime = new BrowserRuntime();
await import('../static/app.js');
