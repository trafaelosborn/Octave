export interface BibTeXEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export function parseBibTeX(source: string): BibTeXEntry[] {
  const entries: BibTeXEntry[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const marker = source.indexOf('@', cursor);
    if (marker < 0) break;
    cursor = marker + 1;

    const typeStart = cursor;
    while (cursor < source.length && /[a-zA-Z]/.test(source[cursor] ?? '')) cursor += 1;
    const type = source.slice(typeStart, cursor).toLowerCase();
    while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
    const open = source[cursor];
    if (!type || (open !== '{' && open !== '(')) continue;
    const close = open === '{' ? '}' : ')';
    const end = findEntryEnd(source, cursor, open, close);
    if (end < 0) break;

    if (type !== 'comment' && type !== 'preamble' && type !== 'string') {
      const body = source.slice(cursor + 1, end);
      const comma = findTopLevelComma(body);
      const key = comma < 0 ? '' : body.slice(0, comma).trim();
      if (key) entries.push({ type, key, fields: parseFields(body.slice(comma + 1)) });
    }
    cursor = end + 1;
  }

  return entries;
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let cursor = 0;

  while (cursor < body.length) {
    cursor = skipSeparators(body, cursor);
    const nameStart = cursor;
    while (cursor < body.length && /[a-zA-Z0-9_:-]/.test(body[cursor] ?? '')) cursor += 1;
    const name = body.slice(nameStart, cursor).trim().toLowerCase();
    cursor = skipWhitespace(body, cursor);
    if (!name || body[cursor] !== '=') {
      cursor = skipToNextComma(body, cursor);
      continue;
    }
    cursor = skipWhitespace(body, cursor + 1);

    const pieces: string[] = [];
    while (cursor < body.length) {
      const parsed = readValue(body, cursor);
      if (!parsed) break;
      pieces.push(parsed.value);
      cursor = skipWhitespace(body, parsed.next);
      if (body[cursor] !== '#') break;
      cursor = skipWhitespace(body, cursor + 1);
    }
    fields[name] = pieces.join('').trim().replace(/\s+/g, ' ');
    cursor = skipToNextComma(body, cursor);
  }

  return fields;
}

function readValue(source: string, cursor: number): { value: string; next: number } | null {
  const first = source[cursor];
  if (first === '{') {
    let depth = 1;
    let escaped = false;
    for (let index = cursor + 1; index < source.length; index += 1) {
      const character = source[index] ?? '';
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth === 0) return { value: source.slice(cursor + 1, index), next: index + 1 };
    }
    return null;
  }

  if (first === '"') {
    let escaped = false;
    for (let index = cursor + 1; index < source.length; index += 1) {
      const character = source[index] ?? '';
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') return { value: source.slice(cursor + 1, index), next: index + 1 };
    }
    return null;
  }

  let end = cursor;
  while (end < source.length && source[end] !== ',' && source[end] !== '#') end += 1;
  return { value: source.slice(cursor, end).trim(), next: end };
}

function findEntryEnd(source: string, start: number, open: string, close: string): number {
  let depth = 1;
  let quoted = false;
  let escaped = false;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function findTopLevelComma(source: string): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === '{' || character === '(') depth += 1;
    if (character === '}' || character === ')') depth -= 1;
    if (character === ',' && depth === 0) return cursor;
  }
  return -1;
}

function skipWhitespace(source: string, cursor: number): number {
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}

function skipSeparators(source: string, cursor: number): number {
  while (cursor < source.length && (source[cursor] === ',' || /\s/.test(source[cursor] ?? ''))) cursor += 1;
  return cursor;
}

function skipToNextComma(source: string, cursor: number): number {
  while (cursor < source.length && source[cursor] !== ',') cursor += 1;
  return cursor < source.length ? cursor + 1 : cursor;
}
