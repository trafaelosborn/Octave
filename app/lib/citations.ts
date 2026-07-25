import {
  buildCitationCorpusIndex,
  isCitationCheckStale,
  isCitationAuditStale,
  inspectCitationWorkspace,
  summarizeCitationSources,
  type CitationSourceRecord,
  type CitationSourceStatus,
} from '@trafaelosborn/octave/core';
import { loadCitationAudit, loadCitationCheck, loadCitationIndex } from '@trafaelosborn/octave/storage';

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
  check: CitationCheckOverview | null;
  summary: {
    cited: number;
    bibliography: number;
    missing: number;
    unused: number;
  };
}

export interface CitationCheckOverview {
  generatedAt: string;
  path: string;
  markdownPath: string;
  stale: boolean;
  summary: {
    claims: number;
    likelySupported: number;
    weakMatch: number;
    noCandidatePassage: number;
    sourceUnavailable: number;
    bibliographyMissing: number;
    warnings: number;
    errors: number;
  };
}

export async function scanCitations(
  workspaceRoot: string,
  options: { unpaywallConfigured?: boolean } = {},
): Promise<CitationScan> {
  const inventory = await inspectCitationWorkspace(workspaceRoot);
  const [existing, audit, check] = await Promise.all([
    loadCitationIndex(workspaceRoot),
    loadCitationAudit(workspaceRoot),
    loadCitationCheck(workspaceRoot),
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
    check: check ? {
      generatedAt: check.generatedAt,
      path: check.artifacts.json,
      markdownPath: check.artifacts.markdown,
      stale: isCitationCheckStale(check, audit, corpus, inventory),
      summary: {
        claims: check.summary.claims,
        likelySupported: check.summary.likely_supported,
        weakMatch: check.summary.weak_match,
        noCandidatePassage: check.summary.no_candidate_passage,
        sourceUnavailable: check.summary.source_unavailable,
        bibliographyMissing: check.summary.bibliography_missing,
        warnings: check.summary.warnings,
        errors: check.summary.errors,
      },
    } : null,
    summary: {
      cited: citedKeys.length,
      bibliography: bibliographyKeys.length,
      missing: missing.length,
      unused: unused.length,
    },
  };
}
