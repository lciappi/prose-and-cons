import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cleanText, MAX_TEXT } from './text.js';

GlobalWorkerOptions.workerSrc = workerURL;

export async function extractPDF(file, layout = 'single') {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file to import.');
  if (file.size > 30 * 1024 * 1024) throw new Error('PDF must be smaller than 30 MB.');
  if (!['single', 'two'].includes(layout)) throw new Error('Choose single-column or two-column reading order.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('This file does not appear to be a PDF.');
  const task = getDocument({ data: bytes, isEvalSupported: false });
  // Do not leave encrypted documents waiting indefinitely for a password prompt.
  task.onPassword = () => task.destroy();
  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    throw new Error('Could not read this PDF. It may be damaged or password-protected; try an unlocked copy.');
  }
  try {
    if (pdf.numPages > 150) throw new Error('This PDF has more than 150 pages. Export a smaller page range first.');
    const pages = [], empty = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const words = items.filter(item => 'str' in item).map(item => {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return { ...item, x, y };
      });
      const regions = layout === 'two' ? [words.filter(item => item.x < viewport.width / 2), words.filter(item => item.x >= viewport.width / 2)] : [words];
      const text = regions.map(region => {
        region.sort((a, b) => Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y);
        return cleanText(region.map((item, i) => `${i && Math.abs(item.y - region[i - 1].y) > 3 ? '\n' : ' '}${item.str}`).join(''));
      }).filter(Boolean).join('\n\n');
      if (text) { pages.push(text); length += text.length; } else empty.push(number);
      page.cleanup();
      if (length > MAX_TEXT) throw new Error('This article is too long. Export a smaller PDF (up to 150,000 characters).');
    }
    if (!pages.length) throw new Error('No readable text found. This may be a scanned PDF. Run OCR first, then import the searchable PDF, or paste its text.');
    const warnings = ['Review reading order, headings, footnotes, and references before narrating. For two-column papers, try the two-column option; full-width titles may need editing.'];
    if (empty.length) warnings.unshift(`No text on page(s) ${empty.join(', ')}. They may be scanned images; review the extraction.`);
    return { text: pages.join('\n\n'), pages: pdf.numPages, warnings, title: file.name.replace(/\.pdf$/i, '') };
  } finally {
    await task.destroy();
  }
}
