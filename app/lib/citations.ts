import {
  buildCitationCorpusIndex,
  isCitationAuditStale,
  inspectCitationWorkspace,
  summarizeCitationSources,
  type CitationSourceRecord,
  type CitationSourceStatus,
} from '@trafaelosborn/octave/core';
import { loadCitationAudit, loadCitationIndex } from '@trafaelosborn/octave/storage';

export interface CitationAuditOverview {
  generatedAt: string;
  path: string;
  stale: boolean;
  truncated: boolean;
  summary: {
    claims: number;
    evidenceFound: number;
    noLexicalMatch: number;
    sourceUnavailable: number;
  };
  byCitation: Record<string, { claims: number; evidenceFound: number; unavailable: number }>;
}

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
  sources: CitationSourceRecord[];
  sourceSummary: Record<CitationSourceStatus, number>;
  unpaywallConfigured: boolean;
  audit: CitationAuditOverview | null;
  summary: {
    cited: number;
    bibliography: number;
    missing: number;
    unused: number;
  };
}

export async function scanCitations(
  workspaceRoot: string,
  options: { unpaywallConfigured?: boolean } = {},
): Promise<CitationScan> {
  const inventory = await inspectCitationWorkspace(workspaceRoot);
  const [existing, audit] = await Promise.all([
    loadCitationIndex(workspaceRoot),
    loadCitationAudit(workspaceRoot),
  ]);
  const corpus = buildCitationCorpusIndex(inventory, existing);
  const cited = new Map<string, CitationIssue>();
  for (const occurrence of inventory.occurrences) {
    if (!cited.has(occurrence.key)) {
      cited.set(occurrence.key, { key: occurrence.key, path: occurrence.path, line: occurrence.line });
    }
  }

  const bibliographyKeys = [...new Set(inventory.entries.map((entry) => entry.key))].sort();
  const bibliographySet = new Set(bibliographyKeys);
  const missing = [...cited.values()].filter((issue) => !bibliographySet.has(issue.key));
  const unused = bibliographyKeys.filter((key) => !cited.has(key));
  const citedKeys = [...cited.keys()].sort();
  const sources = corpus.records.filter((record) => record.cited);

  return {
    citedKeys,
    bibliographyKeys,
    missing,
    unused,
    sources,
    sourceSummary: summarizeCitationSources(sources),
    unpaywallConfigured: options.unpaywallConfigured ?? false,
    audit: audit ? {
      generatedAt: audit.generatedAt,
      path: 'citations/audit.json',
      stale: isCitationAuditStale(audit, corpus, inventory),
      truncated: audit.truncated,
      summary: audit.summary,
      byCitation: Object.fromEntries(sources.map((source) => {
        const packets = audit.packets.filter((packet) => packet.citationKey === source.key);
        return [source.key, {
          claims: packets.length,
          evidenceFound: packets.filter((packet) => packet.status === 'evidence_found').length,
          unavailable: packets.filter((packet) => packet.status === 'source_unavailable').length,
        }];
      })),
    } : null,
    summary: {
      cited: citedKeys.length,
      bibliography: bibliographyKeys.length,
      missing: missing.length,
      unused: unused.length,
    },
  };
}
