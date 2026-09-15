const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="folio-token"]').content;
let activeJob = null;
let importing = false;
let modelReady = false;
let lastFile = null;
let pollTimer = null;
let jobIsPreview = false;
let sourceMode = 'pdf';

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'X-Folio-Token': token, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
function clearError() { $('error').hidden = true; }
function syncControls() {
  const busy = Boolean(activeJob);
  $('generate').disabled = busy || importing || !modelReady || !$('article').value.trim();
  $('preview').disabled = busy || !modelReady;
  $('voice').disabled = busy;
  $('speed').disabled = busy;
  $('pdf-file').disabled = importing;
  $('pdf-layout').disabled = importing;
  $('pdf-tab').disabled = importing;
  $('text-tab').disabled = importing;
  $('article').disabled = importing;
  $('model-status').textContent = !modelReady ? 'Voice model unavailable. Restart with start.command.'
    : importing ? 'Reading PDF…'
    : busy ? (jobIsPreview ? 'Generating voice preview…' : 'Generating audio…')
    : $('article').value.trim() ? 'Ready to generate audio.' : 'Add a PDF or text to get started.';
}
function updateCount() {
  const words = $('article').value.trim().split(/\s+/).filter(Boolean).length;
  $('word-count').textContent = `${words.toLocaleString()} words`;
  $('reading-time').textContent = words ? `About ${Math.max(1, Math.round(words / (155 * Number($('speed').value))))} min of audio` : '';
  $('editor').hidden = sourceMode === 'pdf' && !words && !$('dropzone').classList.contains('has-file');
  syncControls();
}
function selectTab(mode) {
  sourceMode = mode;
  for (const name of ['pdf', 'text']) {
    $(name + '-tab').classList.toggle('active', name === mode);
    $(name + '-tab').setAttribute('aria-pressed', String(name === mode));
  }
  $('pdf-source').hidden = mode !== 'pdf';
  $('editor-label').textContent = mode === 'pdf' ? 'Review text' : 'Text';
  updateCount();
}
$('pdf-tab').onclick = () => selectTab('pdf');
$('text-tab').onclick = () => { selectTab('text'); $('article').focus(); };
for (const id of ['pdf-tab', 'text-tab']) $(id).onkeydown = (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const next = id === 'pdf-tab' ? 'text' : 'pdf';
    selectTab(next); $(next + '-tab').focus();
  }
};
$('article').addEventListener('input', updateCount);
$('speed').addEventListener('input', () => { $('speed-value').textContent = `${Number($('speed').value).toFixed(2)}×`; updateCount(); });
$('voice').onchange = () => {
  $('preview-player').pause(); $('preview-player').hidden = true;
};

async function importPDF(file) {
  if (importing || !file) return;
  clearError();
  if (!file.name.toLowerCase().endsWith('.pdf')) return showError('Choose a PDF file to import.');
  if (file.size > 30 * 1024 * 1024) return showError('PDF must be smaller than 30 MB.');
  if ($('article').value.trim() && !window.confirm('Replace the text in the editor with this PDF?')) return;
  lastFile = file;
  importing = true;
  syncControls();
  selectTab('pdf');
  $('dropzone').classList.add('busy');
  $('upload-title').textContent = 'Reading PDF…';
  $('upload-subtitle').textContent = 'Extracting text';
  const form = new FormData();
  form.append('file', file); form.append('layout', $('pdf-layout').value);
  try {
    const data = await api('/api/extract', { method: 'POST', body: form });
    $('article').value = data.text;
    $('title').value = data.title.slice(0, 160);
    $('page-count').textContent = `${data.pages} page${data.pages === 1 ? '' : 's'}`;
    $('upload-title').textContent = file.name;
    $('upload-subtitle').textContent = 'Choose a different PDF';
    $('dropzone').classList.add('has-file');
    $('extraction-note').textContent = data.warnings.join(' ');
    $('extraction-note').hidden = !data.warnings.length;
  } catch (error) {
    showError(error.message);
    $('upload-title').textContent = 'Try another PDF';
    $('upload-subtitle').textContent = 'Browse files';
  } finally {
    importing = false;
    $('dropzone').classList.remove('busy');
    $('pdf-file').value = '';
    updateCount();
  }
}
$('pdf-file').onchange = (event) => importPDF(event.target.files[0]);
$('pdf-layout').onchange = () => { if (lastFile) importPDF(lastFile); };
$('dropzone').onkeydown = (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!importing) $('pdf-file').click(); } };
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, (event) => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, (event) => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', (event) => importPDF(event.dataTransfer.files[0]));
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

async function startJob(preview) {
  if (activeJob) return;
  clearError();
  // Lock immediately, including while the creation request is in flight.
  activeJob = 'starting'; jobIsPreview = preview;
  syncControls();
  $('preview-player').pause(); $('player').pause();
  const text = preview ? 'This is a preview of the selected voice. You can adjust the reading speed before generating your audio.' : $('article').value;
  try {
    const result = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: $('voice').value, speed: Number($('speed').value), title: preview ? 'Voice preview' : ($('title').value.trim() || 'My article') }) });
    activeJob = result.id;
    sessionStorage.setItem('folio-job', JSON.stringify({ id: activeJob, preview }));
    $('progress-title').textContent = preview ? 'Generating voice preview' : 'Generating audio';
    $('progress-message').textContent = 'Loading voice…';
    $('progress').value = 0;
    $('cancel').disabled = false; $('cancel').textContent = 'Cancel';
    $('progress-panel').hidden = false;
    if (!preview) $('result').hidden = true;
    pollJob();
  } catch (error) { activeJob = null; syncControls(); showError(error.message); }
}
function endJob() {
  activeJob = null;
  sessionStorage.removeItem('folio-job');
  $('progress-panel').hidden = true;
  syncControls();
}
async function pollJob() {
  if (!activeJob) return;
  try {
    const data = await api(`/api/jobs/${activeJob}`);
    $('progress').value = data.progress;
    $('progress-message').textContent = data.message;
    if (data.status === 'done') {
      const base = `/api/jobs/${activeJob}/audio`;
      if (jobIsPreview) {
        $('preview-player').src = `${base}.wav`;
        $('preview-player').hidden = false;
        $('preview-player').play().catch(() => {});
      } else {
        $('result-title').textContent = data.title;
        const duration = Math.round(data.duration);
        $('result-meta').textContent = `${data.voice} · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
        const mp3 = data.formats.includes('mp3');
        $('player').src = `${base}.${mp3 ? 'mp3' : 'wav'}`;
        $('download-mp3').hidden = !mp3;
        $('download-mp3').href = `${base}.mp3?download=1`;
        $('download-wav').href = `${base}.wav?download=1`;
        $('result').hidden = false;
        $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      endJob();
    } else if (data.status === 'error' || data.status === 'cancelled') {
      endJob();
      if (data.status === 'error') showError(data.message);
    } else pollTimer = setTimeout(pollJob, 900);
  } catch (error) {
    // A disconnected tab must not unlock a still-running server job.
    showError(`Connection interrupted: ${error.message}`);
    $('progress-message').textContent = 'Reconnecting… Keep the Terminal app running.';
    pollTimer = setTimeout(async () => {
      try { await api(`/api/jobs/${activeJob}`); clearError(); pollJob(); }
      catch (retryError) {
        if (retryError.message.startsWith('This session has ended')) endJob();
        else pollJob();
      }
    }, 3000);
  }
}
$('preview').onclick = () => startJob(true);
$('generate').onclick = () => startJob(false);
$('cancel').onclick = async () => {
  if (!activeJob || activeJob === 'starting') return;
  $('cancel').disabled = true; $('cancel').textContent = 'Cancelling…';
  try { await api(`/api/jobs/${activeJob}/cancel`, { method: 'POST' }); }
  catch (error) { showError(error.message); $('cancel').disabled = false; $('cancel').textContent = 'Cancel'; }
};

async function initialize() {
  try {
    const status = await api('/api/status'); modelReady = status.ready;
    const saved = JSON.parse(sessionStorage.getItem('folio-job') || 'null');
    if (saved && /^[a-f0-9]{32}$/.test(saved.id)) {
      activeJob = saved.id; jobIsPreview = Boolean(saved.preview);
      $('progress-panel').hidden = false; pollJob();
    }
  } catch (error) { showError(error.message); }
  syncControls();
}
initialize();
