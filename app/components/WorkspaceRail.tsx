import type {
  ChatSessionMeta,
  CitationScan,
  OctaveFile,
  OutlineItem,
  RailView,
  ReviewMemoMeta,
  SearchResult,
  SourceInventory,
  SourceRole,
  Workspace,
} from '../lib/client-types';
import { Icon, type IconName } from './Icon';

const railTabs: Array<{ id: RailView; label: string; icon: IconName }> = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'sources', label: 'Sources', icon: 'book' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'reviews', label: 'Reviews', icon: 'book' },
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'citations', label: 'Citations', icon: 'quote' },
  { id: 'context', label: 'Context', icon: 'pin' },
];

export function WorkspaceRail({
  open,
  railView,
  workspaces,
  activeWorkspaceId,
  workspaceFormOpen,
  workspaceName,
  workspacePath,
  files,
  selectedPath,
  pinnedPaths,
  fileFilter,
  searchQuery,
  searchResults,
  searching,
  chats,
  activeChatId,
  reviews,
  activeReviewId,
  outline,
  citations,
  sources,
  syncingCitations,
  checkingCitations,
  syncingSources,
  newDocumentPath,
  onClose,
  onRailView,
  onSelectWorkspace,
  onToggleWorkspaceForm,
  onWorkspaceName,
  onWorkspacePath,
  onAddWorkspace,
  onBrowseWorkspace,
  openingWorkspace,
  pickingWorkspace,
  onRemoveWorkspace,
  onFileFilter,
  onOpenFile,
  onTogglePin,
  onSearchQuery,
  onSearch,
  onOpenSearchResult,
  onNewChat,
  onOpenChat,
  onRenameChat,
  onDeleteChat,
  onOpenReview,
  onOutlineItem,
  onRefreshCitations,
  onSyncCitations,
  onCheckCitations,
  onOpenCitationSource,
  onRefreshSources,
  onSyncSources,
  onOpenSourceFile,
  onBuildSourceBrief,
  onSetSourceRole,
  onNewDocumentPath,
  onCreateDocument,
}: {
  open: boolean;
  railView: RailView;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  workspaceFormOpen: boolean;
  workspaceName: string;
  workspacePath: string;
  files: OctaveFile[];
  selectedPath: string;
  pinnedPaths: string[];
  fileFilter: string;
  searchQuery: string;
  searchResults: SearchResult[];
  searching: boolean;
  chats: ChatSessionMeta[];
  activeChatId: string;
  reviews: ReviewMemoMeta[];
  activeReviewId: string;
  outline: OutlineItem[];
  citations: CitationScan | null;
  sources: SourceInventory | null;
  syncingCitations: boolean;
  checkingCitations: boolean;
  syncingSources: boolean;
  newDocumentPath: string;
  onClose: () => void;
  onRailView: (view: RailView) => void;
  onSelectWorkspace: (id: string) => void;
  onToggleWorkspaceForm: () => void;
  onWorkspaceName: (value: string) => void;
  onWorkspacePath: (value: string) => void;
  onAddWorkspace: () => void;
  onBrowseWorkspace: () => void;
  openingWorkspace: boolean;
  pickingWorkspace: boolean;
  onRemoveWorkspace: (id: string) => void;
  onFileFilter: (value: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onTogglePin: (path: string) => void;
  onSearchQuery: (value: string) => void;
  onSearch: () => void;
  onOpenSearchResult: (result: SearchResult) => void;
  onNewChat: () => void;
  onOpenChat: (chatId: string) => void;
  onRenameChat: (chat: ChatSessionMeta) => void;
  onDeleteChat: (chat: ChatSessionMeta) => void;
  onOpenReview: (reviewId: string) => void;
  onOutlineItem: (item: OutlineItem) => void;
  onRefreshCitations: () => void;
  onSyncCitations: () => void;
  onCheckCitations: () => void;
  onOpenCitationSource: (path: string) => void;
  onRefreshSources: () => void;
  onSyncSources: () => void;
  onOpenSourceFile: (path: string) => void;
  onBuildSourceBrief: () => void;
  onSetSourceRole: (path: string, role: SourceRole) => void;
  onNewDocumentPath: (value: string) => void;
  onCreateDocument: () => void;
}) {
  const filteredFiles = files.filter((file) => file.path.toLowerCase().includes(fileFilter.toLowerCase()));
  return (
    <>
      <button className={`rail-scrim ${open ? 'visible' : ''}`} onClick={onClose} aria-label="Close navigation" />
      <aside className={`workspace-rail ${open ? 'open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">O</div>
          <div className="brand-copy">
            <span>Octave</span>
            <small>Research workstation</small>
          </div>
          <button className="icon-button mobile-only" onClick={onClose} aria-label="Close navigation"><Icon name="close" /></button>
        </div>

        <div className="workspace-picker">
          <div className="workspace-row">
            <select value={activeWorkspaceId} onChange={(event) => onSelectWorkspace(event.target.value)} aria-label="Active workspace">
              <option value="">Choose a workspace</option>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
            <button className="square-button" onClick={onToggleWorkspaceForm} aria-label="Add workspace">{workspaceFormOpen ? '×' : '+'}</button>
          </div>
          {workspaceFormOpen && (
            <div className="workspace-form">
              <input value={workspaceName} onChange={(event) => onWorkspaceName(event.target.value)} placeholder="Workspace name (optional)" />
              <div className="path-picker"><input value={workspacePath} onChange={(event) => onWorkspacePath(event.target.value)} placeholder="Choose a folder or paste its path" /><button className="button button-secondary" disabled={pickingWorkspace} onClick={onBrowseWorkspace}>{pickingWorkspace ? 'Choosing…' : 'Browse…'}</button></div>
              <button className="button button-primary full-width" disabled={!workspacePath.trim() || openingWorkspace} onClick={onAddWorkspace}>{openingWorkspace ? 'Opening…' : 'Open local folder'}</button>
              {workspaces.length > 0 && (
                <div className="workspace-manage-list">
                  {workspaces.map((workspace) => (
                    <div key={workspace.id}>
                      <span title={workspace.rootPath}>{workspace.name}</span>
                      <button onClick={() => onRemoveWorkspace(workspace.id)} aria-label={`Remove ${workspace.name}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="rail-tabs" aria-label="Workspace navigation">
          {railTabs.map((tab) => (
            <button
              key={tab.id}
              className={railView === tab.id ? 'active' : ''}
              onClick={() => onRailView(tab.id)}
              title={tab.label}
            >
              <Icon name={tab.icon} size={16} />
              <span>{tab.label}</span>
              {tab.id === 'chats' && chats.length > 0 && <b>{chats.length}</b>}
              {tab.id === 'reviews' && reviews.length > 0 && <b>{reviews.length}</b>}
              {tab.id === 'sources' && sources?.summary.total ? <b>{sources.summary.total}</b> : null}
              {tab.id === 'context' && pinnedPaths.length > 0 && <b>{pinnedPaths.length}</b>}
              {tab.id === 'citations' && citations?.summary.missing ? <b className="warn-count">{citations.summary.missing}</b> : null}
            </button>
          ))}
        </nav>

        <div className="rail-content">
          {railView === 'files' && (
            <div className="rail-section">
              <div className="section-heading"><span>Workspace files</span><small>{files.length}</small></div>
              <div className="input-with-icon"><Icon name="search" size={15}/><input value={fileFilter} onChange={(event) => onFileFilter(event.target.value)} placeholder="Filter files" /></div>
              <div className="file-list">
                {filteredFiles.map((file) => (
                  <div className={`file-row ${selectedPath === file.path ? 'selected' : ''}`} key={file.path}>
                    <button className="file-open" onClick={() => onOpenFile(file.path)} title={file.path}>
                      <FileGlyph extension={file.extension} />
                      <span>{file.path}</span>
                    </button>
                    <button className={`pin-button ${pinnedPaths.includes(file.path) ? 'pinned' : ''}`} onClick={() => onTogglePin(file.path)} title="Toggle pinned context">
                      <Icon name="pin" size={13}/>
                    </button>
                  </div>
                ))}
                {filteredFiles.length === 0 && <RailEmpty text="No matching research files." />}
              </div>
              <div className="new-document">
                <input value={newDocumentPath} onChange={(event) => onNewDocumentPath(event.target.value)} placeholder="new-paper.tex" />
                <button onClick={onCreateDocument}>Create</button>
              </div>
            </div>
          )}

          {railView === 'sources' && (
            <div className="rail-section">
              <div className="section-heading">
                <span>Source library</span>
                <div className="section-actions">
                  <button className="text-button" onClick={onRefreshSources} disabled={syncingSources}>Refresh</button>
                  <button className="text-button" onClick={onSyncSources} disabled={syncingSources}>{syncingSources ? 'Saving...' : 'Save inventory'}</button>
                </div>
              </div>
              {sources ? (
                <>
                  <p className="rail-explainer">Files in <code>sources/</code>, <code>primary/</code>, <code>secondary/</code>, <code>archive/</code>, or <code>data/</code> become an evidence shelf for source-grounded briefs.</p>
                  <div className="source-metrics">
                    <Metric label="Total" value={sources.summary.total}/>
                    <Metric label="Primary" value={sources.summary.primary}/>
                    <Metric label="Secondary" value={sources.summary.secondary}/>
                    <Metric label="Archive/data" value={sources.summary.dataset_archive}/>
                  </div>
                  <button className="button button-secondary full-width" onClick={onBuildSourceBrief} disabled={sources.items.length === 0}>Build source brief</button>
                  {!sources.sourceRootsPresent && (
                    <p className="citation-setup-note">Create a <code>sources/</code> folder, then add PDFs, documents, notes, spreadsheets, or images. Octave will inventory them here.</p>
                  )}
                  {sources.items.length > 0 && (
                    <button className="text-button" onClick={() => onOpenSourceFile(sources.inventoryPath)}>Open machine-readable inventory</button>
                  )}
                  <div className="source-list">
                    {sources.items.map((source) => (
                      <article className={`source-card source-role-${source.role}`} key={source.path}>
                        <header>
                          <button onClick={() => onOpenSourceFile(source.path)} title={source.path}>{source.path}</button>
                          <span>{source.roleSource}</span>
                        </header>
                        <label>
                          <span>Type</span>
                          <select value={source.role} onChange={(event) => onSetSourceRole(source.path, event.target.value as SourceRole)}>
                            <option value="primary">Primary</option>
                            <option value="secondary">Secondary</option>
                            <option value="dataset_archive">Archive/data</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </label>
                        <small>{source.rationale}</small>
                        <div className="source-tags">{source.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                      </article>
                    ))}
                    {sources.items.length === 0 && <RailEmpty text="No source folders found yet." />}
                  </div>
                </>
              ) : <RailEmpty text="Source inventory appears after a workspace is opened." />}
            </div>
          )}

          {railView === 'search' && (
            <div className="rail-section">
              <div className="section-heading"><span>Search workspace</span></div>
              <form onSubmit={(event) => { event.preventDefault(); onSearch(); }} className="rail-search-form">
                <input value={searchQuery} onChange={(event) => onSearchQuery(event.target.value)} placeholder="Terms in the project" />
                <button className="button button-secondary" disabled={searching || searchQuery.trim().length < 2}>{searching ? 'Searching...' : 'Search'}</button>
              </form>
              <div className="search-results">
                {searchResults.map((result) => (
                  <button key={`${result.path}-${result.line}-${result.column}`} onClick={() => onOpenSearchResult(result)}>
                    <span>{result.path}:{result.line}</span>
                    <small>{result.preview}</small>
                  </button>
                ))}
                {searchResults.length === 0 && <RailEmpty text="Search TeX, BibTeX, Markdown, notes, and source files." />}
              </div>
            </div>
          )}

          {railView === 'chats' && (
            <div className="rail-section">
              <button className="button button-secondary full-width" onClick={onNewChat}>+ New research chat</button>
              <div className="chat-list">
                {chats.map((chat) => (
                  <div key={chat.id} className={`chat-row ${activeChatId === chat.id ? 'selected' : ''}`}>
                    <button className="chat-open" onClick={() => onOpenChat(chat.id)}>
                    <span>{chat.title}</span>
                    <small>{chat.scope === 'document' ? chat.documentPath : 'Project conversation'} · {timeAgo(chat.updatedAt)}</small>
                    </button>
                    <div className="chat-row-actions">
                      <button type="button" onClick={() => onRenameChat(chat)} aria-label={`Rename ${chat.title}`}>Rename</button>
                      <button type="button" onClick={() => onDeleteChat(chat)} aria-label={`Delete ${chat.title}`}>Delete</button>
                    </div>
                  </div>
                ))}
                {chats.length === 0 && <RailEmpty text="Conversations remain inside this workspace." />}
              </div>
            </div>
          )}

          {railView === 'reviews' && (
            <div className="rail-section">
              <div className="section-heading"><span>Saved review memos</span><small>{reviews.length}</small></div>
              <p className="rail-explainer">Durable Markdown artifacts saved from completed Octave responses.</p>
              <div className="review-list">
                {reviews.map((review) => (
                  <button key={review.id} className={activeReviewId === review.id ? 'selected' : ''} onClick={() => onOpenReview(review.id)}>
                    <span>{review.title}</span>
                    <small>{review.documentPath ?? 'Project review'} · {timeAgo(review.createdAt)}</small>
                  </button>
                ))}
                {reviews.length === 0 && <RailEmpty text="Save a completed assistant response to create a review memo." />}
              </div>
            </div>
          )}

          {railView === 'outline' && (
            <div className="rail-section">
              <div className="section-heading"><span>Document outline</span><small>{outline.length}</small></div>
              <div className="outline-list">
                {outline.map((item) => (
                  <button key={`${item.line}-${item.title}`} className={item.level} onClick={() => onOutlineItem(item)}>
                    <span>{item.title}</span><small>{item.line}</small>
                  </button>
                ))}
                {outline.length === 0 && <RailEmpty text="Open a LaTeX document with section headings." />}
              </div>
            </div>
          )}

          {railView === 'citations' && (
            <div className="rail-section">
              <div className="section-heading">
                <span>Citation sources</span>
                <div className="section-actions">
                  <button className="text-button" onClick={onRefreshCitations} disabled={syncingCitations || checkingCitations}>Refresh</button>
                  <button className="text-button" onClick={onCheckCitations} disabled={syncingCitations || checkingCitations || !citations?.audit}>{checkingCitations ? 'Checking...' : 'Check'}</button>
                  <button className="text-button" onClick={onSyncCitations} disabled={syncingCitations || checkingCitations}>{syncingCitations ? 'Fetching...' : 'Fetch sources'}</button>
                </div>
              </div>
              {citations ? (
                <>
                  <div className="citation-metrics">
                    <Metric label="Cited" value={citations.summary.cited}/>
                    <Metric label="Bib entries" value={citations.summary.bibliography}/>
                    <Metric label="Missing" value={citations.summary.missing} warning/>
                    <Metric label="Unused" value={citations.summary.unused}/>
                  </div>
                  <div className="citation-source-metrics">
                    <Metric label="Downloaded" value={citations.sourceSummary.downloaded}/>
                    <Metric label="Manual" value={citations.sourceSummary.manual_required + citations.sourceSummary.blocked_by_license} warning/>
                    <Metric label="Pending" value={citations.sourceSummary.unresolved + citations.sourceSummary.metadata_only}/>
                    <Metric label="Failed" value={citations.sourceSummary.failed + citations.sourceSummary.ambiguous} warning/>
                  </div>
                  {citations.audit && (
                    <div className="citation-audit-summary">
                      <div>
                        <strong>Evidence packets</strong>
                        <span>{citations.audit.summary.evidenceFound}/{citations.audit.summary.claims} claims have lexical source passages</span>
                      </div>
                      {citations.audit.stale && <small>Stale — fetch sources again</small>}
                      <button onClick={() => onOpenCitationSource(citations.audit!.path)}>Open machine-readable audit</button>
                    </div>
                  )}
                  {citations.check && (
                    <div className="citation-check-summary">
                      <div>
                        <strong>Citation check</strong>
                        <span>{citations.check.summary.likelySupported}/{citations.check.summary.claims} likely supported · {citations.check.summary.warnings} warnings · {citations.check.summary.errors} errors</span>
                      </div>
                      {citations.check.stale && <small>Stale — run Check again</small>}
                      <button onClick={() => onOpenCitationSource(citations.check!.markdownPath)}>Open check report</button>
                    </div>
                  )}
                  {!citations.unpaywallConfigured && citations.sources.some((source) => source.identifiers.doi) && (
                    <p className="citation-setup-note">Set <code>OCTAVE_SCHOLARLY_EMAIL</code> to enable DOI open-access lookup through Unpaywall.</p>
                  )}
                  {citations.missing.length > 0 && <p className="rail-label warning">Missing bibliography entries</p>}
                  {citations.missing.map((issue) => (
                    <button className="citation-issue" key={issue.key} onClick={() => onOpenFile(issue.path, issue.line)}>
                      <span>{issue.key}</span><small>{issue.path}:{issue.line}</small>
                    </button>
                  ))}
                  {citations.unused.length > 0 && <p className="rail-label">Unused bibliography keys</p>}
                  <div className="key-cloud">{citations.unused.slice(0, 24).map((key) => <span key={key}>{key}</span>)}</div>
                  <p className="rail-label">Cited source corpus</p>
                  <div className="citation-source-list">
                    {citations.sources.map((source) => {
                      const externalUrl = citationExternalUrl(source);
                      const evidence = citations.audit?.byCitation[source.key];
                      return (
                        <article className={`citation-source citation-status-${source.status}`} key={source.key}>
                          <header><strong>{source.key}</strong><span>{citationStatusLabel(source.status)}</span></header>
                          <p>{source.metadata.title ?? source.reason ?? 'Bibliography metadata unavailable'}</p>
                          {source.reason && source.metadata.title && <small>{source.reason}</small>}
                          {evidence && <small>{evidence.evidenceFound}/{evidence.claims} cited claims have candidate passages{evidence.unavailable ? ` · ${evidence.unavailable} unavailable` : ''}</small>}
                          {source.status === 'downloaded' && source.acquisition && (
                            <button onClick={() => onOpenCitationSource(source.acquisition!.extractedPath)}>Open extracted text</button>
                          )}
                          {source.status !== 'downloaded' && (
                            <small>Manual file: <code>{source.directory}/manual.pdf</code> or <code>{source.directory}/manual.xml</code></small>
                          )}
                          {externalUrl && <a href={externalUrl} target="_blank" rel="noreferrer">Open source record</a>}
                        </article>
                      );
                    })}
                    {citations.sources.length === 0 && <RailEmpty text="Cited bibliography entries will appear here." />}
                  </div>
                </>
              ) : <RailEmpty text="Citation status appears after a workspace is opened." />}
            </div>
          )}

          {railView === 'context' && (
            <div className="rail-section">
              <p className="rail-explainer">Pinned files join the active document as bounded context on every chat turn.</p>
              <div className="context-list">
                {pinnedPaths.map((documentPath) => (
                  <div key={documentPath}>
                    <button onClick={() => onOpenFile(documentPath)}><Icon name="file" size={14}/><span>{documentPath}</span></button>
                    <button onClick={() => onTogglePin(documentPath)} aria-label={`Unpin ${documentPath}`}>×</button>
                  </div>
                ))}
                {pinnedPaths.length === 0 && <RailEmpty text="Pin supporting notes, bibliographies, or source files from the Files view." />}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function FileGlyph({ extension }: { extension: string }) {
  const label = extension.replace('.', '').slice(0, 3).toUpperCase() || 'DOC';
  return <span className={`file-glyph file-${label.toLowerCase()}`}>{label}</span>;
}

function RailEmpty({ text }: { text: string }) {
  return <p className="rail-empty">{text}</p>;
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className={warning && value > 0 ? 'warning' : ''}><b>{value}</b><span>{label}</span></div>;
}

function timeAgo(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function citationStatusLabel(status: CitationScan['sources'][number]['status']): string {
  const labels: Record<CitationScan['sources'][number]['status'], string> = {
    not_requested: 'Not requested',
    unresolved: 'Ready',
    downloaded: 'Downloaded',
    metadata_only: 'Metadata only',
    manual_required: 'Manual needed',
    blocked_by_license: 'Closed access',
    ambiguous: 'Ambiguous',
    failed: 'Failed',
  };
  return labels[status];
}

function citationExternalUrl(source: CitationScan['sources'][number]): string | undefined {
  if (source.acquisition?.landingPageUrl?.startsWith('https://')) return source.acquisition.landingPageUrl;
  if (source.identifiers.doi) return `https://doi.org/${source.identifiers.doi.split('/').map(encodeURIComponent).join('/')}`;
  if (source.identifiers.arxivId) return `https://arxiv.org/abs/${encodeURIComponent(source.identifiers.arxivId)}`;
  if (source.metadata.url?.startsWith('https://')) return source.metadata.url;
  return undefined;
}
