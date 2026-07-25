import {
  buildCitationEvidenceAudit,
  isCitationAuditStale,
  type CitationEvidenceAudit,
  type CitationEvidencePacket,
} from './citation-evidence.js';
import {
  buildCitationCorpusIndex,
  inspectCitationWorkspace,
  type CitationCorpusIndex,
  type CitationSourceRecord,
  type CitationWorkspaceInventory,
} from './citation-corpus.js';
import {
  ensureCitationDirectory,
  loadCitationIndex,
  saveCitationIndex,
  saveCitationCheck,
} from '../storage/citation-storage.js';

export type CitationCheckVerdict =
  | 'likely_supported'
  | 'weak_match'
  | 'no_candidate_passage'
  | 'source_unavailable'
  | 'bibliography_missing';

export type CitationCheckSeverity = 'ok' | 'warn' | 'error';

export interface CitationCheckFinding {
  id: string;
  citationKey: string;
  path: string;
  line: number;
  claim: string;
  verdict: CitationCheckVerdict;
  severity: CitationCheckSeverity;
  rationale: string;
  sourceStatus: CitationSourceRecord['status'];
  sourceTitle?: string;
  topPassages: Array<{
    locator: string;
    text: string;
    lexicalScore: number;
  }>;
}

export interface CitationCheckReport {
  version: 1;
  generatedAt: string;
  auditGeneratedAt: string;
  stale: boolean;
  truncated: boolean;
  artifacts: {
    json: string;
    markdown: string;
  };
  summary: Record<CitationCheckVerdict, number> & {
    claims: number;
    ok: number;
    warnings: number;
    errors: number;
  };
  findings: CitationCheckFinding[];
}

const CHECK_JSON_PATH = 'citations/check.json';
const CHECK_MARKDOWN_PATH = 'citations/check.md';

export async function buildCitationCheckReport(workspaceRoot: string): Promise<CitationCheckReport> {
  await ensureCitationDirectory(workspaceRoot);
  const [inventory, existingIndex] = await Promise.all([
    inspectCitationWorkspace(workspaceRoot),
    loadCitationIndex(workspaceRoot),
  ]);
  const index = buildCitationCorpusIndex(inventory, existingIndex);
  await saveCitationIndex(workspaceRoot, index);
  const audit = await buildCitationEvidenceAudit(workspaceRoot);
  const stale = isCitationAuditStale(audit, index, inventory);
  const recordByKey = new Map(index.records.map((record) => [record.key, record]));
  const findings = audit.packets.map((packet) => classifyPacket(packet, recordByKey.get(packet.citationKey)));
  const report: CitationCheckReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    auditGeneratedAt: audit.generatedAt,
    stale,
    truncated: audit.truncated,
    artifacts: {
      json: CHECK_JSON_PATH,
      markdown: CHECK_MARKDOWN_PATH,
    },
    summary: summarizeFindings(findings),
    findings,
  };
  await saveCitationCheck(workspaceRoot, report, renderCitationCheckMarkdown(report));
  return report;
}

export function isCitationCheckStale(
  report: CitationCheckReport,
  audit: CitationEvidenceAudit | null,
  index: CitationCorpusIndex,
  inventory?: CitationWorkspaceInventory,
): boolean {
  if (!audit) return true;
  if (report.auditGeneratedAt !== audit.generatedAt) return true;
  return report.stale || isCitationAuditStale(audit, index, inventory);
}

function classifyPacket(packet: CitationEvidencePacket, record?: CitationSourceRecord): CitationCheckFinding {
  const topPassages = packet.passages.slice(0, 3).map((passage) => ({
    locator: passage.locator,
    text: passage.text,
    lexicalScore: passage.lexicalScore,
  }));
  const topScore = topPassages[0]?.lexicalScore ?? 0;
  const base = {
    id: packet.id,
    citationKey: packet.citationKey,
    path: packet.claim.path,
    line: packet.claim.line,
    claim: packet.claim.text,
    sourceStatus: packet.sourceStatus,
    ...(packet.sourceTitle ? { sourceTitle: packet.sourceTitle } : {}),
    topPassages,
  };

  if (record?.entryType === 'missing') {
    return {
      ...base,
      verdict: 'bibliography_missing',
      severity: 'error',
      rationale: 'The citation key appears in the document, but no matching bibliography entry was found.',
    };
  }

  if (packet.status === 'source_unavailable') {
    return {
      ...base,
      verdict: 'source_unavailable',
      severity: 'warn',
      rationale: 'Octave does not have extracted source text for this citation yet, so the claim cannot be checked against the cited paper.',
    };
  }

  if (packet.status === 'no_lexical_match') {
    return {
      ...base,
      verdict: 'no_candidate_passage',
      severity: 'error',
      rationale: 'The cited source was available, but no lexical candidate passage matched this cited claim.',
    };
  }

  if (topScore >= 0.35) {
    return {
      ...base,
      verdict: 'likely_supported',
      severity: 'ok',
      rationale: 'The cited source contains a nearby lexical match for the cited claim. This is evidence for review, not a proof of support.',
    };
  }

  return {
    ...base,
    verdict: 'weak_match',
    severity: 'warn',
    rationale: 'The cited source has a candidate passage, but the lexical overlap is weak. Review the passage manually.',
  };
}

function summarizeFindings(findings: CitationCheckFinding[]): CitationCheckReport['summary'] {
  const summary: CitationCheckReport['summary'] = {
    claims: findings.length,
    likely_supported: 0,
    weak_match: 0,
    no_candidate_passage: 0,
    source_unavailable: 0,
    bibliography_missing: 0,
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

function renderCitationCheckMarkdown(report: CitationCheckReport): string {
  const lines = [
    '# Citation check report',
    '',
    `Generated: ${report.generatedAt}`,
    `Audit generated: ${report.auditGeneratedAt}`,
    `Audit stale: ${report.stale ? 'yes' : 'no'}`,
    `Audit truncated: ${report.truncated ? 'yes' : 'no'}`,
    '',
    '## Summary',
    '',
    `- Claims checked: ${report.summary.claims}`,
    `- Likely supported: ${report.summary.likely_supported}`,
    `- Weak lexical match: ${report.summary.weak_match}`,
    `- No candidate passage: ${report.summary.no_candidate_passage}`,
    `- Source unavailable: ${report.summary.source_unavailable}`,
    `- Bibliography missing: ${report.summary.bibliography_missing}`,
    '',
    'This report uses lexical retrieval against the cited source text. Treat “likely supported” as a review aid, not a formal entailment judgment.',
    '',
    '## Findings',
    '',
  ];

  for (const finding of report.findings) {
    lines.push(
      `### ${finding.citationKey} — ${verdictLabel(finding.verdict)}`,
      '',
      `- Location: \`${finding.path}:${finding.line}\``,
      `- Severity: ${finding.severity}`,
      `- Source status: ${finding.sourceStatus}`,
      ...(finding.sourceTitle ? [`- Source title: ${finding.sourceTitle}`] : []),
      `- Rationale: ${finding.rationale}`,
      '',
      `> ${finding.claim || '[Empty claim context]'}`,
      '',
    );
    if (finding.topPassages.length > 0) {
      lines.push('Candidate passages:', '');
      for (const passage of finding.topPassages) {
        lines.push(
          `- ${passage.locator} (lexical score ${passage.lexicalScore.toFixed(2)})`,
          `  > ${passage.text.replace(/\s+/g, ' ').slice(0, 700)}`,
        );
      }
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

function verdictLabel(verdict: CitationCheckVerdict): string {
  if (verdict === 'likely_supported') return 'Likely supported';
  if (verdict === 'weak_match') return 'Weak lexical match';
  if (verdict === 'no_candidate_passage') return 'No candidate passage';
  if (verdict === 'source_unavailable') return 'Source unavailable';
  return 'Bibliography missing';
}
