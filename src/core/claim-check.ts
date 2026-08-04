import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CitationCheckFinding, CitationCheckReport } from './citation-check.js';
import type { EvidenceMap, EvidencePassage } from './evidence-map.js';
import { readDocument } from './path.js';

export const CLAIM_CHECK_VERSION = 1;
export const CLAIM_CHECKS_DIRECTORY = '.octave/claim-checks';
export const MAX_CLAIM_CHECK_DOCUMENT_CHARS = 500_000;
export const MAX_CLAIM_CHECK_CLAIMS = 200;
export const MAX_CLAIM_CHECK_PASSAGES = 3;

export type ClaimCheckVerdict =
  | 'likely_supported'
  | 'weak_source_match'
  | 'citation_warning'
  | 'citation_error'
  | 'no_candidate_evidence'
  | 'no_evidence_available';

export type ClaimCheckSeverity = 'ok' | 'warn' | 'error';

export interface DraftClaim {
  id: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  citationKeys: string[];
}

export interface ClaimEvidenceMatch {
  evidenceMapId: string;
  evidenceMapTitle: string;
  passageId: string;
  sourcePath: string;
  sourceRole: EvidencePassage['role'];
  locator: string;
  text: string;
  lexicalScore: number;
}

export interface ClaimCheckFinding {
  id: string;
  claim: DraftClaim;
  verdict: ClaimCheckVerdict;
  severity: ClaimCheckSeverity;
  rationale: string;
  evidenceMatches: ClaimEvidenceMatch[];
  citationFindings: Array<Pick<CitationCheckFinding, 'id' | 'citationKey' | 'line' | 'verdict' | 'severity' | 'rationale'>>;
}

export interface ClaimCheckReport {
  version: typeof CLAIM_CHECK_VERSION;
  id: string;
  documentPath: string;
  generatedAt: string;
  artifactPaths: {
    json: string;
    markdown: string;
  };
  evidenceMapIds: string[];
  citationCheckGeneratedAt?: string;
  truncated: boolean;
  summary: Record<ClaimCheckVerdict, number> & {
    claims: number;
    ok: number;
    warnings: number;
    errors: number;
  };
  findings: ClaimCheckFinding[];
  warnings: string[];
}

export type ClaimCheckMeta = Omit<ClaimCheckReport, 'findings'> & {
  findingCount: number;
};

export async function buildClaimCheckReport(
  workspaceRoot: string,
  documentPath: string,
  evidenceMaps: EvidenceMap[],
  citationCheck: CitationCheckReport | null = null,
): Promise<ClaimCheckReport> {
  const document = await readDocument(documentPath, workspaceRoot, MAX_CLAIM_CHECK_DOCUMENT_CHARS);
  const claims = extractDraftClaims(document.path, document.content).slice(0, MAX_CLAIM_CHECK_CLAIMS);
  const warnings = [...document.warnings];
  if (document.truncated) warnings.push(`Draft was truncated to ${MAX_CLAIM_CHECK_DOCUMENT_CHARS.toLocaleString()} characters before claim extraction.`);
  if (claims.length >= MAX_CLAIM_CHECK_CLAIMS) warnings.push(`Only the first ${MAX_CLAIM_CHECK_CLAIMS} candidate claims were checked.`);

  const evidencePassages = flattenEvidenceMaps(evidenceMaps);
  const findings = claims.map((claim) => classifyClaim(claim, evidencePassages, citationCheck));
  const id = randomUUID();
  const artifactBase = path.posix.join(CLAIM_CHECKS_DIRECTORY, id);
  const report: ClaimCheckReport = {
    version: CLAIM_CHECK_VERSION,
    id,
    documentPath: document.path,
    generatedAt: new Date().toISOString(),
    artifactPaths: {
      json: `${artifactBase}.json`,
      markdown: `${artifactBase}.md`,
    },
    evidenceMapIds: evidenceMaps.map((map) => map.id),
    ...(citationCheck ? { citationCheckGeneratedAt: citationCheck.generatedAt } : {}),
    truncated: document.truncated || claims.length >= MAX_CLAIM_CHECK_CLAIMS,
    summary: summarizeFindings(findings),
    findings,
    warnings,
  };
  return report;
}

export function serializeClaimCheckMarkdown(report: ClaimCheckReport): string {
  const lines = [
    '# Claim check report',
    '',
    `Document: \`${report.documentPath}\``,
    `Generated: ${report.generatedAt}`,
    `JSON: \`${report.artifactPaths.json}\``,
    `Evidence maps: ${report.evidenceMapIds.length ? report.evidenceMapIds.join(', ') : 'none'}`,
    `Citation check: ${report.citationCheckGeneratedAt ?? 'not available'}`,
    '',
    '## Summary',
    '',
    `- Claims checked: ${report.summary.claims}`,
    `- Likely supported: ${report.summary.likely_supported}`,
    `- Weak source match: ${report.summary.weak_source_match}`,
    `- Citation warnings: ${report.summary.citation_warning}`,
    `- Citation errors: ${report.summary.citation_error}`,
    `- No candidate evidence: ${report.summary.no_candidate_evidence}`,
    `- No evidence available: ${report.summary.no_evidence_available}`,
    '',
    'This report uses deterministic lexical matching against saved evidence maps and existing citation-check findings. Treat it as a review queue, not final scholarly judgment.',
    '',
    '## Findings',
    '',
  ];

  for (const finding of report.findings) {
    lines.push(
      `### ${finding.claim.id} — ${verdictLabel(finding.verdict)}`,
      '',
      `- Location: \`${finding.claim.path}:${finding.claim.lineStart}-${finding.claim.lineEnd}\``,
      `- Severity: ${finding.severity}`,
      `- Rationale: ${finding.rationale}`,
      finding.claim.citationKeys.length > 0 ? `- Citation keys: ${finding.claim.citationKeys.join(', ')}` : '- Citation keys: none detected',
      '',
      `> ${finding.claim.text}`,
      '',
    );
    if (finding.evidenceMatches.length > 0) {
      lines.push('Candidate source passages:', '');
      for (const match of finding.evidenceMatches) {
        lines.push(
          `- \`${match.sourcePath}\` (${match.sourceRole}, ${match.locator}, lexical score ${match.lexicalScore.toFixed(2)})`,
          `  > ${match.text.replace(/\s+/g, ' ').slice(0, 700)}`,
        );
      }
      lines.push('');
    }
    if (finding.citationFindings.length > 0) {
      lines.push('Citation check findings:', '');
      for (const citation of finding.citationFindings) {
        lines.push(`- ${citation.citationKey}: ${citation.verdict} (${citation.severity}) — ${citation.rationale}`);
      }
      lines.push('');
    }
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings', '', ...report.warnings.map((warning) => `- ${warning}`), '');
  }

  return `${lines.join('\n')}\n`;
}

export function toClaimCheckMeta(report: ClaimCheckReport): ClaimCheckMeta {
  const { findings, ...metadata } = report;
  return { ...metadata, findingCount: findings.length };
}

export function isClaimCheckReport(value: unknown): value is ClaimCheckReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<ClaimCheckReport>;
  return (
    report.version === CLAIM_CHECK_VERSION &&
    typeof report.id === 'string' &&
    typeof report.documentPath === 'string' &&
    typeof report.generatedAt === 'string' &&
    Boolean(report.artifactPaths) &&
    typeof report.artifactPaths?.json === 'string' &&
    typeof report.artifactPaths?.markdown === 'string' &&
    Array.isArray(report.evidenceMapIds) &&
    Boolean(report.summary) &&
    Array.isArray(report.findings) &&
    Array.isArray(report.warnings)
  );
}

export function extractDraftClaims(documentPath: string, content: string): DraftClaim[] {
  const lines = content.split(/\r?\n/);
  const claims: DraftClaim[] = [];
  let start = 1;
  let buffer: string[] = [];

  const flush = (endLine: number) => {
    const raw = buffer.join(' ').trim();
    const text = cleanClaimText(raw);
    if (text.length >= 80 && !isLikelyNonClaim(raw)) {
      claims.push({
        id: `claim-${claims.length + 1}`,
        path: documentPath,
        lineStart: start,
        lineEnd: endLine,
        text,
        citationKeys: citationKeys(raw),
      });
    }
    buffer = [];
  };

  lines.forEach((line, index) => {
    if (!line.trim()) {
      if (buffer.length > 0) flush(index);
      start = index + 2;
      return;
    }
    if (buffer.length === 0) start = index + 1;
    buffer.push(line);
  });
  if (buffer.length > 0) flush(lines.length);
  return claims;
}

function classifyClaim(
  claim: DraftClaim,
  evidencePassages: Array<ClaimEvidenceMatch & { searchableText: string }>,
  citationCheck: CitationCheckReport | null,
): ClaimCheckFinding {
  const evidenceMatches = rankEvidenceMatches(claim.text, evidencePassages).slice(0, MAX_CLAIM_CHECK_PASSAGES);
  const citationFindings = citationCheck
    ? citationCheck.findings
      .filter((finding) => finding.path === claim.path && finding.line >= claim.lineStart && finding.line <= claim.lineEnd)
      .map((finding) => ({
        id: finding.id,
        citationKey: finding.citationKey,
        line: finding.line,
        verdict: finding.verdict,
        severity: finding.severity,
        rationale: finding.rationale,
      }))
    : [];
  const worstCitation = citationFindings.find((finding) => finding.severity === 'error')
    ?? citationFindings.find((finding) => finding.severity === 'warn');
  if (worstCitation?.severity === 'error') {
    return finding(claim, 'citation_error', 'error', 'A formal citation attached to this claim has an error in the citation check report.', evidenceMatches, citationFindings);
  }
  if (worstCitation?.severity === 'warn') {
    return finding(claim, 'citation_warning', 'warn', 'A formal citation attached to this claim has a warning in the citation check report.', evidenceMatches, citationFindings);
  }
  if (evidencePassages.length === 0) {
    return finding(claim, 'no_evidence_available', 'warn', 'No saved evidence-map passages are available for source-grounded checking.', [], citationFindings);
  }
  const topScore = evidenceMatches[0]?.lexicalScore ?? 0;
  if (topScore >= 0.35) {
    return finding(claim, 'likely_supported', 'ok', 'Saved evidence maps contain a strong lexical candidate passage for this claim. Review the passage before treating the claim as supported.', evidenceMatches, citationFindings);
  }
  if (topScore >= 0.2) {
    return finding(claim, 'weak_source_match', 'warn', 'Saved evidence maps contain a candidate passage, but lexical overlap is weak.', evidenceMatches, citationFindings);
  }
  return finding(claim, 'no_candidate_evidence', 'error', 'No saved evidence-map passage matched this claim.', evidenceMatches, citationFindings);
}

function finding(
  claim: DraftClaim,
  verdict: ClaimCheckVerdict,
  severity: ClaimCheckSeverity,
  rationale: string,
  evidenceMatches: ClaimEvidenceMatch[],
  citationFindings: ClaimCheckFinding['citationFindings'],
): ClaimCheckFinding {
  return {
    id: claim.id,
    claim,
    verdict,
    severity,
    rationale,
    evidenceMatches,
    citationFindings,
  };
}

function flattenEvidenceMaps(evidenceMaps: EvidenceMap[]): Array<ClaimEvidenceMatch & { searchableText: string }> {
  return evidenceMaps.flatMap((map) => map.passages.map((passage) => ({
    evidenceMapId: map.id,
    evidenceMapTitle: map.title,
    passageId: passage.id,
    sourcePath: passage.sourcePath,
    sourceRole: passage.role,
    locator: passage.locator,
    text: passage.text,
    lexicalScore: 0,
    searchableText: passage.text,
  })));
}

function rankEvidenceMatches(
  claim: string,
  passages: Array<ClaimEvidenceMatch & { searchableText: string }>,
): ClaimEvidenceMatch[] {
  const claimTokens = tokens(claim);
  if (claimTokens.size === 0) return [];
  return passages
    .map((passage) => {
      const passageTokens = tokens(passage.searchableText);
      let matches = 0;
      for (const token of claimTokens) if (passageTokens.has(token)) matches += 1;
      return {
        ...passage,
        lexicalScore: matches / claimTokens.size,
        matches,
      };
    })
    .filter((passage) => passage.matches >= Math.min(2, claimTokens.size) && passage.lexicalScore >= 0.15)
    .sort((left, right) => right.lexicalScore - left.lexicalScore || left.passageId.localeCompare(right.passageId))
    .map(({ searchableText, matches, ...passage }) => {
      void searchableText;
      void matches;
      return passage;
    });
}

function summarizeFindings(findings: ClaimCheckFinding[]): ClaimCheckReport['summary'] {
  const summary: ClaimCheckReport['summary'] = {
    claims: findings.length,
    likely_supported: 0,
    weak_source_match: 0,
    citation_warning: 0,
    citation_error: 0,
    no_candidate_evidence: 0,
    no_evidence_available: 0,
    ok: 0,
    warnings: 0,
    errors: 0,
  };
  for (const finding of findings) {
    summary[finding.verdict] += 1;
    if (finding.severity === 'ok') summary.ok += 1;
    if (finding.severity === 'warn') summary.warnings += 1;
    if (finding.severity === 'error') summary.errors += 1;
  }
  return summary;
}

function cleanClaimText(value: string): string {
  return value
    .replace(/%.*$/gm, '')
    .replace(/\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{[^}]+\}/g, '')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^}]*)\}/g, '$1')
    .replace(/[{}$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function citationKeys(value: string): string[] {
  const keys = new Set<string>();
  for (const match of value.matchAll(/\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{([^}]+)\}/g)) {
    for (const key of (match[1] ?? '').split(',').map((part) => part.trim()).filter(Boolean)) keys.add(key);
  }
  return [...keys].sort();
}

function isLikelyNonClaim(value: string): boolean {
  return /^\\(?:section|subsection|subsubsection|begin|end|bibliography|bibliographystyle|documentclass|usepackage)\b/i.test(value.trim());
}

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'because', 'been', 'before', 'being', 'between', 'both', 'could', 'does', 'for', 'from',
  'have', 'into', 'more', 'most', 'only', 'other', 'over', 'same', 'such', 'than', 'that', 'their', 'there',
  'the', 'these', 'they', 'this', 'those', 'through', 'under', 'using', 'very', 'were', 'what', 'when', 'where', 'which',
  'while', 'with', 'would', 'within', 'without',
]);

function tokens(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((token) => !STOP_WORDS.has(token)));
}

function verdictLabel(verdict: ClaimCheckVerdict): string {
  if (verdict === 'likely_supported') return 'Likely supported';
  if (verdict === 'weak_source_match') return 'Weak source match';
  if (verdict === 'citation_warning') return 'Citation warning';
  if (verdict === 'citation_error') return 'Citation error';
  if (verdict === 'no_candidate_evidence') return 'No candidate evidence';
  return 'No evidence available';
}
