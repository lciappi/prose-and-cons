import { inject } from '@vercel/analytics';
import { BrowserRuntime } from './runtime.js';

inject({ mode: import.meta.env.PROD ? 'production' : 'development' });

window.folioRuntime = new BrowserRuntime();
await import('../static/app.js');
