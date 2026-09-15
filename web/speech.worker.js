import { KokoroTTS } from 'kokoro-js';
import { Mp3Encoder } from '@breezystack/lamejs';
import { splitText } from './text.js';
import { pcm16, SAMPLE_RATE, wavBlob } from './audio.js';

let engine;
self.onmessage = async ({ data: { id, text, voice, speed } }) => {
  const report = values => self.postMessage({ id, ...values });
  try {
    if (!engine) {
      engine = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8', device: 'wasm',
        progress_callback: event => {
          if (event.status === 'progress') report({ message: `Downloading voice model… ${Math.round(event.progress)}%`, progress: 0 });
        },
      });
    }
    const chunks = splitText(text);
    const wavParts = [], mp3Parts = [];
    let total = 0;
    let encoder;
    try { encoder = new Mp3Encoder(1, SAMPLE_RATE, 128); }
    catch { /* WAV generation does not depend on the optional MP3 encoder. */ }
    const append = pcm => {
      // Store PCM in Blobs so article-length float arrays are not retained.
      wavParts.push(new Blob([pcm]));
      total += pcm.length;
      if (!encoder) return;
      try {
        for (let offset = 0; offset < pcm.length; offset += 1152) {
          const bytes = encoder.encodeBuffer(pcm.subarray(offset, offset + 1152));
          if (bytes.length) mp3Parts.push(new Blob([bytes]));
        }
      } catch {
        encoder = null;
        mp3Parts.length = 0;
      }
    };
    for (let i = 0; i < chunks.length; i++) {
      report({ message: `Narrating passage ${i + 1} of ${chunks.length}…`, progress: Math.round(i / chunks.length * 95) });
      const audio = await engine.generate(chunks[i], { voice, speed });
      if (audio.sampling_rate !== SAMPLE_RATE) throw new Error('Unexpected sample rate');
      append(pcm16(audio.audio));
      if (i < chunks.length - 1) append(new Int16Array(6000));
    }
    const audio = { wav: wavBlob(wavParts, total) };
    if (encoder) {
      try {
        mp3Parts.push(new Blob([encoder.flush()]));
        audio.mp3 = new Blob(mp3Parts, { type: 'audio/mpeg' });
      } catch { /* WAV remains available if MP3 encoding fails. */ }
    }
    report({ status: 'done', message: 'Your listening time is ready.', progress: 100, duration: total / SAMPLE_RATE, audio });
  } catch (error) {
    console.error('Speech generation failed', error);
    engine = null;
    report({ status: 'error', message: 'Could not generate audio. Check your connection for the first model download, try a shorter passage, or use an up-to-date desktop browser.' });
  }
};
