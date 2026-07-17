import type { OutlineItem } from './client-types';

export function parseLatexOutline(source: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*\\(section|subsection|subsubsection)\*?\{(.+)\}/);
    if (!match?.[1] || !match[2]) return;
    items.push({
      level: match[1] as OutlineItem['level'],
      title: cleanLatexTitle(match[2]),
      line: index + 1,
    });
  });
  return items;
}

function cleanLatexTitle(title: string): string {
  return title
    .replace(/\\(?:textbf|textit|emph|texorpdfstring)\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}$]/g, '')
    .trim();
}
