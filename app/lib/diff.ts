export interface DiffRow {
  kind: 'same' | 'add' | 'remove' | 'omit';
  beforeLine?: number;
  afterLine?: number;
  text: string;
}

export interface DiffHunk {
  id: string;
  beforeChangeStart: number;
  beforeChangeEnd: number;
  afterChangeStart: number;
  afterChangeEnd: number;
  rows: DiffRow[];
  added: number;
  removed: number;
}

interface DiffOperation {
  kind: 'same' | 'add' | 'remove';
  beforeLine?: number;
  afterLine?: number;
  text: string;
}

export function buildDiffHunks(before: string, after: string): DiffHunk[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const operations = buildDiffOperations(beforeLines, afterLines);
  const changeIndexes = operations
    .map((operation, index) => operation.kind === 'same' ? -1 : index)
    .filter((index) => index >= 0);

  if (changeIndexes.length === 0) return [];

  const contextLines = 4;
  const groups: Array<{
    displayStart: number;
    displayEnd: number;
    changeStart: number;
    changeEnd: number;
  }> = [];

  for (const changeIndex of changeIndexes) {
    const displayStart = Math.max(0, changeIndex - contextLines);
    const displayEnd = Math.min(operations.length, changeIndex + contextLines + 1);
    const previous = groups.at(-1);

    if (previous && displayStart <= previous.displayEnd) {
      previous.displayEnd = Math.max(previous.displayEnd, displayEnd);
      previous.changeEnd = changeIndex + 1;
    } else {
      groups.push({ displayStart, displayEnd, changeStart: changeIndex, changeEnd: changeIndex + 1 });
    }
  }

  return groups.map((group, index) => {
    const changed = operations.slice(group.changeStart, group.changeEnd);
    const displayed = operations.slice(group.displayStart, group.displayEnd);
    const rows: DiffRow[] = displayed.map((operation) => {
      const row: DiffRow = { kind: operation.kind, text: operation.text };
      if (operation.beforeLine !== undefined) row.beforeLine = operation.beforeLine + 1;
      if (operation.afterLine !== undefined) row.afterLine = operation.afterLine + 1;
      return row;
    });

    if (group.displayStart > 0) {
      rows.unshift({ kind: 'omit', text: `${group.displayStart} earlier lines hidden` });
    }
    if (group.displayEnd < operations.length) {
      rows.push({ kind: 'omit', text: `${operations.length - group.displayEnd} later lines hidden` });
    }

    const beforeChangeStart = countConsumedLines(operations.slice(0, group.changeStart), 'before');
    const afterChangeStart = countConsumedLines(operations.slice(0, group.changeStart), 'after');
    return {
      id: `hunk-${index}-${beforeChangeStart}-${afterChangeStart}`,
      beforeChangeStart,
      beforeChangeEnd: countConsumedLines(operations.slice(0, group.changeEnd), 'before'),
      afterChangeStart,
      afterChangeEnd: countConsumedLines(operations.slice(0, group.changeEnd), 'after'),
      rows,
      added: changed.filter((operation) => operation.kind === 'add').length,
      removed: changed.filter((operation) => operation.kind === 'remove').length,
    };
  });
}

export function materializeRevision(
  before: string,
  after: string,
  hunks: DiffHunk[],
  includedHunks: ReadonlySet<string>,
): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const result: string[] = [];
  let beforeCursor = 0;

  for (const hunk of hunks) {
    result.push(...beforeLines.slice(beforeCursor, hunk.beforeChangeStart));
    result.push(...(includedHunks.has(hunk.id)
      ? afterLines.slice(hunk.afterChangeStart, hunk.afterChangeEnd)
      : beforeLines.slice(hunk.beforeChangeStart, hunk.beforeChangeEnd)));
    beforeCursor = hunk.beforeChangeEnd;
  }

  result.push(...beforeLines.slice(beforeCursor));
  return result.join('\n');
}

function buildDiffOperations(beforeLines: string[], afterLines: string[]): DiffOperation[] {
  if (beforeLines.length * afterLines.length > 500_000) {
    return [
      ...beforeLines.map((text, index) => ({ kind: 'remove' as const, beforeLine: index, text })),
      ...afterLines.map((text, index) => ({ kind: 'add' as const, afterLine: index, text })),
    ];
  }

  const table = Array.from(
    { length: beforeLines.length + 1 },
    () => new Uint32Array(afterLines.length + 1),
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const row = table[beforeIndex];
      const nextRow = table[beforeIndex + 1];
      if (!row || !nextRow) continue;
      row[afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? (nextRow[afterIndex + 1] ?? 0) + 1
        : Math.max(nextRow[afterIndex] ?? 0, row[afterIndex + 1] ?? 0);
    }
  }

  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    const beforeText = beforeLines[beforeIndex] ?? '';
    const afterText = afterLines[afterIndex] ?? '';
    if (beforeText === afterText) {
      operations.push({ kind: 'same', beforeLine: beforeIndex, afterLine: afterIndex, text: beforeText });
      beforeIndex += 1;
      afterIndex += 1;
    } else if ((table[beforeIndex + 1]?.[afterIndex] ?? 0) >= (table[beforeIndex]?.[afterIndex + 1] ?? 0)) {
      operations.push({ kind: 'remove', beforeLine: beforeIndex, text: beforeText });
      beforeIndex += 1;
    } else {
      operations.push({ kind: 'add', afterLine: afterIndex, text: afterText });
      afterIndex += 1;
    }
  }

  while (beforeIndex < beforeLines.length) {
    operations.push({ kind: 'remove', beforeLine: beforeIndex, text: beforeLines[beforeIndex] ?? '' });
    beforeIndex += 1;
  }
  while (afterIndex < afterLines.length) {
    operations.push({ kind: 'add', afterLine: afterIndex, text: afterLines[afterIndex] ?? '' });
    afterIndex += 1;
  }
  return operations;
}

function countConsumedLines(operations: DiffOperation[], side: 'before' | 'after'): number {
  return operations.reduce((count, operation) => {
    if (side === 'before') return operation.kind === 'add' ? count : count + 1;
    return operation.kind === 'remove' ? count : count + 1;
  }, 0);
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
