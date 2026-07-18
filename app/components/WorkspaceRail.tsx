import type {
  ChatSessionMeta,
  CitationScan,
  OctaveFile,
  OutlineItem,
  RailView,
  SearchResult,
  Workspace,
} from '../lib/client-types';
import { Icon, type IconName } from './Icon';

const railTabs: Array<{ id: RailView; label: string; icon: IconName }> = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'chats', label: 'Chats', icon: 'chat' },
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
  outline,
  citations,
  newDocumentPath,
  onClose,
  onRailView,
  onSelectWorkspace,
  onToggleWorkspaceForm,
  onWorkspaceName,
  onWorkspacePath,
  onAddWorkspace,
  onRemoveWorkspace,
  onFileFilter,
  onOpenFile,
  onTogglePin,
  onSearchQuery,
  onSearch,
  onOpenSearchResult,
  onNewChat,
  onOpenChat,
  onOutlineItem,
  onRefreshCitations,
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
  outline: OutlineItem[];
  citations: CitationScan | null;
  newDocumentPath: string;
  onClose: () => void;
  onRailView: (view: RailView) => void;
  onSelectWorkspace: (id: string) => void;
  onToggleWorkspaceForm: () => void;
  onWorkspaceName: (value: string) => void;
  onWorkspacePath: (value: string) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (id: string) => void;
  onFileFilter: (value: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onTogglePin: (path: string) => void;
  onSearchQuery: (value: string) => void;
  onSearch: () => void;
  onOpenSearchResult: (result: SearchResult) => void;
  onNewChat: () => void;
  onOpenChat: (chatId: string) => void;
  onOutlineItem: (item: OutlineItem) => void;
  onRefreshCitations: () => void;
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
              <input value={workspacePath} onChange={(event) => onWorkspacePath(event.target.value)} placeholder="C:\Research\Paper" />
              <button className="button button-primary full-width" disabled={!workspacePath.trim()} onClick={onAddWorkspace}>Open local folder</button>
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
                  <button key={chat.id} className={activeChatId === chat.id ? 'selected' : ''} onClick={() => onOpenChat(chat.id)}>
                    <span>{chat.title}</span>
                    <small>{chat.scope === 'document' ? chat.documentPath : 'Project conversation'} · {timeAgo(chat.updatedAt)}</small>
                  </button>
                ))}
                {chats.length === 0 && <RailEmpty text="Conversations remain inside this workspace." />}
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
              <div className="section-heading"><span>Citation audit</span><button className="text-button" onClick={onRefreshCitations}>Refresh</button></div>
              {citations ? (
                <>
                  <div className="citation-metrics">
                    <Metric label="Cited" value={citations.summary.cited}/>
                    <Metric label="Bib entries" value={citations.summary.bibliography}/>
                    <Metric label="Missing" value={citations.summary.missing} warning/>
                    <Metric label="Unused" value={citations.summary.unused}/>
                  </div>
                  {citations.missing.length > 0 && <p className="rail-label warning">Missing bibliography entries</p>}
                  {citations.missing.map((issue) => (
                    <button className="citation-issue" key={issue.key} onClick={() => onOpenFile(issue.path, issue.line)}>
                      <span>{issue.key}</span><small>{issue.path}:{issue.line}</small>
                    </button>
                  ))}
                  {citations.unused.length > 0 && <p className="rail-label">Unused bibliography keys</p>}
                  <div className="key-cloud">{citations.unused.slice(0, 24).map((key) => <span key={key}>{key}</span>)}</div>
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
