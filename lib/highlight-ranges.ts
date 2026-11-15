export type HighlightRange = { start: number; end: number; id: string };

function pieces(quote: string) {
  return quote.split(/\n+/).map((piece) => piece.trim()).filter((piece) => piece.length >= 2);
}

function pattern(piece: string) {
  return new RegExp(piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "g");
}

// Un subrayado puede cruzar párrafos: cada párrafo marca solo los trozos de la cita que contiene.
export function findHighlightRanges(text: string, highlights: Array<{ id: string; quote: string }>): HighlightRange[] {
  const found = highlights.flatMap((highlight) => pieces(highlight.quote).flatMap((piece) =>
    [...text.matchAll(pattern(piece))].map((match) => ({ start: match.index, end: match.index + match[0].length, id: highlight.id }))));
  const ordered = found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: HighlightRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
