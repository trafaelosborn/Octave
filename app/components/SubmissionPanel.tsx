import type {
  OctaveFile,
  SubmissionAuthor,
  SubmissionManifest,
  SubmissionPackage,
  SubmissionPreflight,
} from '../lib/client-types';
import { Icon } from './Icon';

const PROFILE_OPTIONS: Array<{ id: SubmissionManifest['venue']['profile']; name: string; detail: string }> = [
  { id: 'generic', name: 'Journal or general submission', detail: 'Metadata, source hygiene, PDF, citations, and declarations' },
  { id: 'anonymous-conference', name: 'Anonymous conference', detail: 'Adds author and identifying-metadata checks' },
  { id: 'arxiv', name: 'arXiv source package', detail: 'Requires TeX and a complete dependency archive' },
];

const DECLARATIONS: Array<{ key: keyof SubmissionManifest['declarations']; label: string }> = [
  { key: 'authorshipConfirmed', label: 'Every author approved the submission and author order.' },
  { key: 'conflictsReviewed', label: 'Conflicts and suggested or opposed reviewers were reviewed.' },
  { key: 'fundingReviewed', label: 'Funding and grant disclosures were reviewed.' },
  { key: 'ethicsReviewed', label: 'Ethics, consent, data, and code statements were reviewed where applicable.' },
  { key: 'licenseReviewed', label: 'Copyright, license, originality, and venue declarations were reviewed.' },
];

export function SubmissionPanel({
  manifest,
  preflight,
  packages,
  files,
  workspaceId,
  busy,
  onManifest,
  onAction,
}: {
  manifest: SubmissionManifest | null;
  preflight: SubmissionPreflight | null;
  packages: SubmissionPackage[];
  files: OctaveFile[];
  workspaceId: string;
  busy: 'loading' | 'saving' | 'preflight' | 'package' | null;
  onManifest: (manifest: SubmissionManifest) => void;
  onAction: (action: 'save' | 'preflight' | 'package') => void;
}) {
  if (!manifest || !preflight) {
    return (
      <div className="empty-pane submission-empty">
        <Icon name="file" size={30}/>
        <h3>{busy === 'loading' ? 'Opening Submission Desk...' : 'Submission Desk is not loaded'}</h3>
        <p>Choose a workspace and manuscript to prepare a submission.</p>
      </div>
    );
  }

  const manuscriptFiles = files.filter((file) => file.extension === '.tex' || file.extension === '.pdf');
  const supplementFiles = files.filter((file) => file.path !== manifest.manuscriptPath);
  const errors = preflight.issues.filter((current) => current.severity === 'error');
  const warnings = preflight.issues.filter((current) => current.severity === 'warning');
  const manual = preflight.issues.filter((current) => current.severity === 'manual');

  function update(patch: Partial<SubmissionManifest>): void {
    onManifest({ ...manifest!, ...patch });
  }

  function updateVenue(patch: Partial<SubmissionManifest['venue']>): void {
    update({ venue: { ...manifest!.venue, ...patch } });
  }

  function updateAuthor(index: number, patch: Partial<SubmissionAuthor>): void {
    update({ authors: manifest!.authors.map((author, authorIndex) => authorIndex === index ? { ...author, ...patch } : author) });
  }

  return (
    <div className="submission-panel">
      <header className="submission-header">
        <div>
          <p className="eyebrow">Submission Desk</p>
          <h2>Package the paper, not the workspace</h2>
          <p>Octave follows the manuscript's local dependencies, checks the exact upload set, and keeps legal attestations in human hands.</p>
        </div>
        <div className="submission-summary">
          <Metric value={preflight.summary.error} label="blocking" tone="error" />
          <Metric value={preflight.summary.warning} label="warnings" tone="warning" />
          <Metric value={preflight.summary.manual} label="confirm" tone="manual" />
          {preflight.pdfPages !== undefined && <Metric value={preflight.pdfPages} label="PDF pages" />}
        </div>
      </header>

      <div className="submission-toolbar">
        <span>{preflight.packageable ? preflight.ready ? 'Ready to package and submit' : 'Packageable; human confirmations remain' : 'Resolve blocking checks before packaging'}</span>
        <div>
          <button className="button button-quiet" disabled={busy !== null} onClick={() => onAction('save')}>{busy === 'saving' ? 'Saving...' : 'Save manifest'}</button>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => onAction('preflight')}>{busy === 'preflight' ? 'Checking...' : 'Run preflight'}</button>
          <button className="button button-primary" disabled={busy !== null || !preflight.packageable} onClick={() => onAction('package')}>{busy === 'package' ? 'Building...' : 'Build package'}</button>
        </div>
      </div>

      <div className="submission-scroll">
        <section className="submission-card submission-target-card">
          <div className="submission-card-heading"><span>01</span><div><h3>Target and manuscript</h3><p>Profiles add checks without changing your source.</p></div></div>
          <div className="submission-grid three">
            <label><span>Profile</span><select value={manifest.venue.profile} onChange={(event) => updateVenue({ profile: event.target.value as SubmissionManifest['venue']['profile'] })}>{PROFILE_OPTIONS.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><small>{PROFILE_OPTIONS.find((profile) => profile.id === manifest.venue.profile)?.detail}</small></label>
            <label><span>Venue</span><input value={manifest.venue.name} onChange={(event) => updateVenue({ name: event.target.value })} placeholder="Journal or conference name" /></label>
            <label><span>Article type</span><input value={manifest.venue.articleType} onChange={(event) => updateVenue({ articleType: event.target.value })} placeholder="Research article" /></label>
            <label className="wide"><span>Manuscript</span><select value={manifest.manuscriptPath} onChange={(event) => update({ manuscriptPath: event.target.value })}><option value="">Choose TeX or PDF</option>{manuscriptFiles.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label>
            <label><span>Page limit <small>optional</small></span><input type="number" min="1" value={manifest.venue.maxPages ?? ''} onChange={(event) => {
              const venue = { ...manifest.venue };
              if (event.target.value) venue.maxPages = Number(event.target.value);
              else delete venue.maxPages;
              update({ venue });
            }} /></label>
          </div>
        </section>

        <section className="submission-card">
          <div className="submission-card-heading"><span>02</span><div><h3>Portal metadata</h3><p>This becomes the machine-readable submission manifest.</p></div></div>
          <div className="submission-grid">
            <label className="full"><span>Title</span><input value={manifest.title} onChange={(event) => update({ title: event.target.value })} /></label>
            <label className="full"><span>Abstract</span><textarea value={manifest.abstract} onChange={(event) => update({ abstract: event.target.value })} rows={5} /></label>
            <label className="full"><span>Keywords <small>comma-separated</small></span><input value={manifest.keywords.join(', ')} onChange={(event) => update({ keywords: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
          </div>
          <div className="submission-authors-heading"><h4>Authors</h4><button className="text-button" onClick={() => update({ authors: [...manifest.authors, { name: '' }] })}>+ Add author</button></div>
          <div className="submission-author-list">
            {manifest.authors.map((author, index) => (
              <article key={index}>
                <label><span>Name</span><input value={author.name} onChange={(event) => updateAuthor(index, { name: event.target.value })} /></label>
                <label><span>Email</span><input type="email" value={author.email ?? ''} onChange={(event) => updateAuthor(index, { email: event.target.value })} /></label>
                <label><span>Affiliation</span><input value={author.affiliation ?? ''} onChange={(event) => updateAuthor(index, { affiliation: event.target.value })} /></label>
                <label><span>ORCID</span><input value={author.orcid ?? ''} onChange={(event) => updateAuthor(index, { orcid: event.target.value })} placeholder="0000-0000-0000-0000" /></label>
                <label className="submission-corresponding"><input type="checkbox" checked={author.corresponding ?? false} onChange={(event) => updateAuthor(index, { corresponding: event.target.checked })} /><span>Corresponding</span></label>
                <button className="icon-button" onClick={() => update({ authors: manifest.authors.filter((_, authorIndex) => authorIndex !== index) })} aria-label={`Remove ${author.name || `author ${index + 1}`}`}><Icon name="close" size={15}/></button>
              </article>
            ))}
            {manifest.authors.length === 0 && <p className="submission-inline-empty">No authors yet. Add every author in final order.</p>}
          </div>
        </section>

        <section className="submission-card">
          <div className="submission-card-heading"><span>03</span><div><h3>Supplementary files</h3><p>The TeX source archive is discovered automatically. Select only additional uploads here.</p></div></div>
          <details className="submission-file-picker">
            <summary>{manifest.supplementaryFiles.length ? `${manifest.supplementaryFiles.length} supplementary file${manifest.supplementaryFiles.length === 1 ? '' : 's'} selected` : 'Choose supplementary files'}</summary>
            <div>{supplementFiles.map((file) => <label key={file.path}><input type="checkbox" checked={manifest.supplementaryFiles.includes(file.path)} onChange={() => update({ supplementaryFiles: manifest.supplementaryFiles.includes(file.path) ? manifest.supplementaryFiles.filter((current) => current !== file.path) : [...manifest.supplementaryFiles, file.path] })} /><span>{file.path}</span><small>{formatBytes(file.size)}</small></label>)}</div>
          </details>
        </section>

        <section className="submission-card">
          <div className="submission-card-heading"><span>04</span><div><h3>Human declarations</h3><p>Octave records these confirmations but never invents or silently accepts them.</p></div></div>
          <div className="submission-declarations">{DECLARATIONS.map((declaration) => <label key={declaration.key}><input type="checkbox" checked={manifest.declarations[declaration.key]} onChange={(event) => update({ declarations: { ...manifest.declarations, [declaration.key]: event.target.checked } })} /><span>{declaration.label}</span></label>)}</div>
        </section>

        <section className="submission-card">
          <div className="submission-card-heading"><span>05</span><div><h3>Preflight report</h3><p>{preflight.sourceFiles.length} source files, {formatBytes(preflight.totalSourceBytes)} in the sanitized dependency archive.</p></div></div>
          <IssueGroup title="Blocking" issues={errors} empty="No blocking problems found." />
          <IssueGroup title="Human confirmation" issues={manual} empty="All required human confirmations are recorded." />
          <IssueGroup title="Warnings" issues={warnings} empty="No warnings." />
        </section>

        <section className="submission-card">
          <div className="submission-card-heading"><span>06</span><div><h3>Generated packages</h3><p>Each package preserves its manifest, preflight report, hashes, PDF, source ZIP, and supplements.</p></div></div>
          <div className="submission-package-list">
            {packages.slice(0, 8).map((submissionPackage) => (
              <article key={submissionPackage.id}>
                <div><strong>{submissionPackage.venue || submissionPackage.title || 'Submission package'}</strong><small>{new Date(submissionPackage.createdAt).toLocaleString()} &middot; {submissionPackage.artifacts.length} artifacts</small></div>
                <div>{submissionPackage.artifacts.filter((artifact) => ['submission-bundle.zip', 'manuscript.pdf', 'source.zip'].includes(artifact.name)).map((artifact) => <a key={artifact.name} href={artifactUrl(workspaceId, submissionPackage.id, artifact.name)} download>{artifact.name === 'submission-bundle.zip' ? 'Bundle' : artifact.name === 'manuscript.pdf' ? 'PDF' : 'Source'}</a>)}</div>
              </article>
            ))}
            {packages.length === 0 && <p className="submission-inline-empty">No packages yet. Resolve blocking checks, then build the first immutable upload set.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function IssueGroup({ title, issues, empty }: { title: string; issues: SubmissionPreflight['issues']; empty: string }) {
  return (
    <div className="submission-issue-group">
      <h4>{title} <span>{issues.length}</span></h4>
      {issues.length ? issues.map((current, index) => <div className={`submission-issue ${current.severity}`} key={`${current.code}-${current.path ?? ''}-${current.line ?? index}`}><b>{current.severity === 'error' ? '!' : current.severity === 'manual' ? '?' : 'i'}</b><span>{current.message}{current.path && <small>{current.path}{current.line ? `:${current.line}` : ''}</small>}</span></div>) : <p className="submission-check-clear">{empty}</p>}
    </div>
  );
}

function Metric({ value, label, tone = '' }: { value: number; label: string; tone?: string }) {
  return <div className={tone}><b>{value}</b><span>{label}</span></div>;
}

function artifactUrl(workspaceId: string, packageId: string, artifact: string): string {
  return `/api/submissions?workspaceId=${encodeURIComponent(workspaceId)}&packageId=${encodeURIComponent(packageId)}&artifact=${encodeURIComponent(artifact)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
