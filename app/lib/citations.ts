import { listProjectFiles, readDocument } from '@trafaelosborn/octave/core';

export interface CitationIssue {
  key: string;
  path: string;
  line: number;
}

export interface CitationScan {
  citedKeys: string[];
  bibliographyKeys: string[];
  missing: CitationIssue[];
  unused: string[];
  summary: {
    cited: number;
    bibliography: number;
    missing: number;
    unused: number;
  };
}

export async function scanCitations(workspaceRoot: string): Promise<CitationScan> {
  const files = await listProjectFiles(workspaceRoot);
  const cited = new Map<string, CitationIssue>();
  const bibliographyKeys = new Set<string>();

  for (const file of files) {
    if (file.extension !== '.tex' && file.extension !== '.bib') continue;
    const document = await readDocument(file.path, workspaceRoot, 1_000_000);

    if (file.extension === '.bib') {
      for (const match of document.content.matchAll(/@[a-zA-Z]+\s*\{\s*([^,\s]+)\s*,/g)) {
        const key = match[1]?.trim();
        if (key) bibliographyKeys.add(key);
      }
      continue;
    }

    const lines = document.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{([^}]+)\}/g)) {
        for (const rawKey of (match[1] ?? '').split(',')) {
          const key = rawKey.trim();
          if (key && !cited.has(key)) cited.set(key, { key, path: file.path, line: index + 1 });
        }
      }
    });
  }

  const missing = [...cited.values()].filter((issue) => !bibliographyKeys.has(issue.key));
  const unused = [...bibliographyKeys].filter((key) => !cited.has(key)).sort();
  const citedKeys = [...cited.keys()].sort();
  const bibliography = [...bibliographyKeys].sort();

  return {
    citedKeys,
    bibliographyKeys: bibliography,
    missing,
    unused,
    summary: {
      cited: citedKeys.length,
      bibliography: bibliography.length,
      missing: missing.length,
      unused: unused.length,
    },
  };
}
