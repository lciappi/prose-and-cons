import { test, expect } from '@playwright/test';

test('static app reads a PDF without API calls and rejects invalid files', async ({ page }) => {
  const apiRequests = [];
  const errors = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Preview voice' })).toBeEnabled();
  await page.locator('#pdf-file').setInputFiles('tests/fixtures/dummy.pdf');
  await expect(page.locator('#article')).toHaveValue('Dummy PDF file');
  await expect(page.locator('#page-count')).toHaveText('1 page');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#pdf-file').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toContainText('does not appear to be a PDF');
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('cancellation interrupts model loading and unlocks the interface', async ({ page }) => {
  await page.route('https://huggingface.co/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview voice' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#progress-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Preview voice' })).toBeEnabled();
});

test('failed model downloads show an error and allow retry', async ({ page }) => {
  await page.route('https://huggingface.co/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview voice' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not generate audio', { timeout: 30_000 });
  await expect(page.locator('#progress-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Preview voice' })).toBeEnabled();
});

test('real Kokoro generates non-silent WAV and decodable MP3 in the browser', async ({ page }) => {
  test.skip(!process.env.TEST_REAL_SPEECH, 'Set TEST_REAL_SPEECH=1 to download and run the real model.');
  test.setTimeout(300_000);
  page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Paste text', exact: true }).click();
  await page.locator('#article').fill('Hello world. This is Prose and Cons.');
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 240_000 });
  for (const format of ['wav', 'mp3']) {
    const samples = await page.locator(`#download-${format}`).evaluate(async link => {
      const data = await (await fetch(link.href)).arrayBuffer();
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(data);
        return { duration: audio.duration, nonSilent: audio.getChannelData(0).some(sample => Math.abs(sample) > 0.001) };
      } finally { await context.close(); }
    });
    expect(samples.duration).toBeGreaterThan(1);
    expect(samples.nonSilent).toBe(true);
  }
});
