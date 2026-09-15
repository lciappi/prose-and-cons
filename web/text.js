export const MAX_TEXT = 150_000;

export function cleanText(text) {
  return text.replace(/[\u0000\u00ad]/g, '').replace(/\r\n?/g, '\n')
    .replace(/(\w)-[ \t]*\n[ \t]*(?=[a-z])/g, '$1')
    .split(/\n\s*\n/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
}

export function splitText(text, limit = 450) {
  const chunks = [];
  for (const paragraph of cleanText(text).split('\n\n')) {
    let current = '';
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      for (const word of sentence.match(/\S+/g) || []) {
        if (current && current.length + word.length + 1 > limit) {
          chunks.push(current);
          current = '';
        }
        let remainder = word;
        while (remainder.length > limit) {
          chunks.push(remainder.slice(0, limit));
          remainder = remainder.slice(limit);
        }
        current = current ? `${current} ${remainder}` : remainder;
      }
      if (current) { chunks.push(current); current = ''; }
    }
  }
  return chunks;
}
