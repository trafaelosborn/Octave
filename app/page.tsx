'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { Icon } from './components/Icon';
import { PdfPane } from './components/PdfPane';
import { ProviderSettingsDialog } from './components/ProviderSettingsDialog';
import { RevisionPanel } from './components/RevisionPanel';
import { ReviewMemoPanel } from './components/ReviewMemoPanel';
import { SubmissionPanel } from './components/SubmissionPanel';
import { WorkspaceRail } from './components/WorkspaceRail';
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatSessionMeta,
  ChatScope,
  CitationScan,
  DesktopProviderSettings,
  DesktopProviderSettingsInput,
  OctaveFile,
  OutlineItem,
  ProviderStatus,
  RailView,
  ReviewMemo,
  ReviewMemoMeta,
  RevisionPreview,
  SearchResult,
  SourceInventory,
  SourceRole,
  SubmissionManifest,
  SubmissionPackage,
  SubmissionPreflight,
  SubmissionState,
  WorkView,
  Workspace,
} from './lib/client-types';
import { buildDiffHunks, materializeRevision } from './lib/diff';
import { parseLatexOutline } from './lib/outline';
import type { CompileEngine } from '@trafaelosborn/octave/core';

const REVIEW_PROMPT = [
  'Review this document as a serious research memo.',
  'Give a verdict, identify the central contribution, trace the argument structure, and distinguish strengths from technical risks.',
  'Call out missing assumptions, unsupported claims, citation gaps, and the highest-leverage revisions.',
].join(' ');

interface ModelRecoveryState {
  message: string;
  prompt: string;
  providerId: string;
  failedModel: string;
  attachmentPaths: string[];
  includeCitationEvidence: boolean;
}

export default function OctavePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [workspaceFormOpen, setWorkspaceFormOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [files, setFiles] = useState<OctaveFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [documentExtension, setDocumentExtension] = useState('');
  const [documentReadOnly, setDocumentReadOnly] = useState(false);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [newDocumentPath, setNewDocumentPath] = useState('paper.tex');
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatSessionMeta[]>([]);
  const [reviews, setReviews] = useState<ReviewMemoMeta[]>([]);
  const [activeReview, setActiveReview] = useState<ReviewMemo | null>(null);
  const [activeChatId, setActiveChatId] = useState('');
  const [chatScope, setChatScope] = useState<ChatScope>('document');
  const [chatDocumentPath, setChatDocumentPath] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([
    { id: 'demo', name: 'Offline demo', available: true, local: true, models: [{ id: 'demo', name: 'Offline demo' }] },
  ]);
  const [providerId, setProviderId] = useState('demo');
  const [modelId, setModelId] = useState('demo');
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [compileEngine, setCompileEngine] = useState<CompileEngine>('pdflatex');
  const [compileLog, setCompileLog] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [revision, setRevision] = useState<RevisionPreview | null>(null);
  const [includedHunks, setIncludedHunks] = useState<Set<string>>(new Set());
  const [railView, setRailView] = useState<RailView>('files');
  const [workView, setWorkView] = useState<WorkView>('editor');
  const [railOpen, setRailOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [citations, setCitations] = useState<CitationScan | null>(null);
  const [sources, setSources] = useState<SourceInventory | null>(null);
  const [error, setError] = useState('');
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [running, setRunning] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [revising, setRevising] = useState(false);
  const [savingReviewMessageTs, setSavingReviewMessageTs] = useState('');
  const [deletingReview, setDeletingReview] = useState(false);
  const [searching, setSearching] = useState(false);
  const [syncingCitations, setSyncingCitations] = useState(false);
  const [checkingCitations, setCheckingCitations] = useState(false);
  const [syncingSources, setSyncingSources] = useState(false);
  const [desktopProviderSettings, setDesktopProviderSettings] = useState<DesktopProviderSettings | null>(null);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [savingProviderSettings, setSavingProviderSettings] = useState(false);
  const [submissionManifest, setSubmissionManifest] = useState<SubmissionManifest | null>(null);
  const [submissionPreflight, setSubmissionPreflight] = useState<SubmissionPreflight | null>(null);
  const [submissionPackages, setSubmissionPackages] = useState<SubmissionPackage[]>([]);
  const [submissionBusy, setSubmissionBusy] = useState<'loading' | 'saving' | 'preflight' | 'package' | null>(null);
  const [modelRecovery, setModelRecovery] = useState<ModelRecoveryState | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const dirty = content !== savedContent;
  const outline = useMemo(() => parseLatexOutline(content), [content]);
  const lineCount = useMemo(() => Math.max(1, content.split(/\r?\n/).length), [content]);
  const wordCount = useMemo(() => content.trim() ? content.trim().split(/\s+/).length : 0, [content]);
  const revisionHunks = useMemo(
    () => revision ? buildDiffHunks(revision.before, revision.after) : [],
    [revision],
  );
  const canRun = documentExtension === '.py' || documentExtension === '.r';
  const savedReviewMessageIndexes = useMemo(
    () => reviews.filter((review) => review.sourceChatId === activeChatId).map((review) => review.sourceMessageIndex),
    [activeChatId, reviews],
  );

  useEffect(() => {
    bootstrap().catch(showError).finally(() => setBooting(false));
    // Initial bootstrap intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap(): Promise<void> {
    const [workspaceData, providerData, desktopSettings] = await Promise.all([
      apiJson<{ workspaces: Workspace[] }>('/api/workspaces'),
      apiJson<{ providers: ProviderStatus[] }>('/api/providers'),
      window.octaveDesktop?.getProviderSettings() ?? Promise.resolve(null),
    ]);
    setWorkspaces(workspaceData.workspaces);
    setProviders(providerData.providers);
    if (desktopSettings) {
      setDesktopProviderSettings(desktopSettings);
      if (desktopSettings.firstRun) setProviderSettingsOpen(true);
    }

    const savedProvider = window.localStorage.getItem('octave:provider');
    const preferredProvider = providerData.providers.find((provider) => provider.id === desktopSettings?.defaultProvider && provider.available)
      ?? providerData.providers.find((provider) => provider.id === savedProvider && provider.available)
      ?? providerData.providers.find((provider) => provider.id === 'ollama' && provider.available)
      ?? providerData.providers.find((provider) => provider.available);
    if (preferredProvider) {
      setProviderId(preferredProvider.id);
      setModelId(desktopSettings?.models[preferredProvider.id]
        ?? window.localStorage.getItem(`octave:model:${preferredProvider.id}`)
        ?? preferredProvider.models[0]?.id
        ?? '');
    }

    const savedWorkspaceId = window.localStorage.getItem('octave:workspace');
    const workspace = workspaceData.workspaces.find((candidate) => candidate.id === savedWorkspaceId)
      ?? workspaceData.workspaces[0];
    if (workspace) await loadWorkspace(workspace.id, workspaceData.workspaces);
    else setWorkspaceFormOpen(true);
  }

  async function loadWorkspace(workspaceId: string, knownWorkspaces = workspaces): Promise<void> {
    if (!workspaceId) return;
    setActiveWorkspaceId(workspaceId);
    window.localStorage.setItem('octave:workspace', workspaceId);
    setError('');
    setPdfUrl('');
    setCompileLog('');
    setRevision(null);
    setAttachmentPaths([]);
    setActiveReview(null);
    setSubmissionManifest(null);
    setSubmissionPreflight(null);
    setSubmissionPackages([]);
    setSources(null);

    const [fileData, contextData, chatData, reviewData, citationData, sourceData] = await Promise.all([
      apiJson<{ files: OctaveFile[]; workspace: Workspace }>(`/api/files?workspaceId=${encodeURIComponent(workspaceId)}`),
      apiJson<{ pinnedPaths: string[] }>(`/api/context?workspaceId=${encodeURIComponent(workspaceId)}`),
      apiJson<{ chats: ChatSessionMeta[] }>(`/api/chats?workspaceId=${encodeURIComponent(workspaceId)}`),
      apiJson<{ reviews: ReviewMemoMeta[] }>(`/api/reviews?workspaceId=${encodeURIComponent(workspaceId)}`),
      apiJson<CitationScan>(`/api/citations?workspaceId=${encodeURIComponent(workspaceId)}`),
      apiJson<SourceInventory>(`/api/sources?workspaceId=${encodeURIComponent(workspaceId)}`),
    ]);
    setFiles(fileData.files);
    setPinnedPaths(contextData.pinnedPaths);
    setChats(chatData.chats);
    setReviews(reviewData.reviews);
    setCitations(citationData);
    setSources(sourceData);

    const workspace = knownWorkspaces.find((candidate) => candidate.id === workspaceId) ?? fileData.workspace;
    const paths = new Set(fileData.files.map((file) => file.path));
    const nextPath = workspace.lastDocumentPath && paths.has(workspace.lastDocumentPath)
      ? workspace.lastDocumentPath
      : fileData.files.find((file) => file.extension === '.tex')?.path ?? fileData.files[0]?.path ?? '';

    if (nextPath) await loadDocument(nextPath, workspaceId);
    else clearDocument();

    const savedChatId = window.localStorage.getItem(`octave:chat:${workspaceId}`);
    const chat = chatData.chats.find((candidate) => candidate.id === savedChatId) ?? chatData.chats[0];
    if (chat) await loadChat(chat.id, workspaceId, false);
    else {
      setActiveChatId('');
      setChatDocumentPath('');
      setMessages([]);
    }
  }

  async function addWorkspace(): Promise<void> {
    setOpeningWorkspace(true);
    setError('');
    try {
      const input: { rootPath: string; name?: string } = { rootPath: workspacePath };
      if (workspaceName.trim()) input.name = workspaceName.trim();
      const data = await apiJson<{ workspace: Workspace; workspaces: Workspace[] }>('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      setWorkspaces(data.workspaces);
      setWorkspaceName('');
      setWorkspacePath('');
      setWorkspaceFormOpen(false);
      await loadWorkspace(data.workspace.id, data.workspaces);
    } finally {
      setOpeningWorkspace(false);
    }
  }

  async function browseWorkspace(): Promise<void> {
    setPickingWorkspace(true);
    setError('');
    try {
      if (window.octaveDesktop) {
        const selectedPath = await window.octaveDesktop.pickWorkspace();
        if (selectedPath) setWorkspacePath(selectedPath);
        return;
      }
      const data = await apiJson<{ path: string | null }>('/api/workspaces/pick', { method: 'POST' });
      if (data.path) setWorkspacePath(data.path);
    } finally {
      setPickingWorkspace(false);
    }
  }

  async function saveDesktopProviderSettings(input: DesktopProviderSettingsInput): Promise<void> {
    if (!window.octaveDesktop) throw new Error('Provider settings are available only in the desktop app.');
    setSavingProviderSettings(true);
    try {
      const wasFirstRun = Boolean(desktopProviderSettings?.firstRun);
      const settings = await window.octaveDesktop.saveProviderSettings(input);
      setDesktopProviderSettings(settings);
      if (wasFirstRun && !activeWorkspaceId) {
        setRailView('files');
        setRailOpen(true);
        setWorkspaceFormOpen(true);
      }
    } catch (problem) {
      setSavingProviderSettings(false);
      throw problem;
    }
  }

  async function openSubmissionDesk(): Promise<void> {
    if (!activeWorkspaceId) return;
    setWorkView('submission');
    setSubmissionBusy('loading');
    setError('');
    try {
      const data = await apiJson<SubmissionState>(`/api/submissions?workspaceId=${encodeURIComponent(activeWorkspaceId)}&documentPath=${encodeURIComponent(selectedPath)}`);
      setSubmissionManifest(data.manifest);
      setSubmissionPreflight(data.preflight);
      setSubmissionPackages(data.packages);
    } finally {
      setSubmissionBusy(null);
    }
  }

  async function runSubmissionAction(action: 'save' | 'preflight' | 'package'): Promise<void> {
    if (!activeWorkspaceId || !submissionManifest) return;
    setSubmissionBusy(action === 'save' ? 'saving' : action);
    setError('');
    try {
      const data = await apiJson<SubmissionState>('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, action, manifest: submissionManifest }),
      });
      setSubmissionManifest(data.manifest);
      setSubmissionPreflight(data.preflight);
      setSubmissionPackages(data.packages);
    } finally {
      setSubmissionBusy(null);
    }
  }

  async function removeWorkspace(workspaceId: string): Promise<void> {
    const data = await apiJson<{ workspaces: Workspace[] }>(`/api/workspaces?id=${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
    setWorkspaces(data.workspaces);
    if (workspaceId === activeWorkspaceId) {
      const next = data.workspaces[0];
      if (next) await loadWorkspace(next.id, data.workspaces);
      else {
        setActiveWorkspaceId('');
        clearDocument();
        setFiles([]);
        setChats([]);
        setReviews([]);
        setActiveReview(null);
        setAttachmentPaths([]);
        setSources(null);
        setWorkspaceFormOpen(true);
      }
    }
  }

  async function refreshFiles(preferredPath = selectedPath): Promise<void> {
    if (!activeWorkspaceId) return;
    const data = await apiJson<{ files: OctaveFile[] }>(`/api/files?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    setFiles(data.files);
    if (preferredPath && !data.files.some((file) => file.path === preferredPath)) clearDocument();
  }

  async function loadDocument(documentPath: string, workspaceId = activeWorkspaceId, focusLine?: number): Promise<void> {
    const data = await apiJson<{
      path: string;
      extension: string;
      content: string;
      pdfAvailable: boolean;
      readOnly: boolean;
      extractionWarnings: string[];
    }>(`/api/document?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(documentPath)}`);
    setSelectedPath(data.path);
    setDocumentExtension(data.extension);
    setDocumentReadOnly(data.readOnly);
    setExtractionWarnings(data.extractionWarnings);
    setContent(data.content);
    setSavedContent(data.content);
    setPdfUrl(data.pdfAvailable ? pdfEndpoint(workspaceId, data.path) : '');
    setRevision(null);
    setError('');

    if (focusLine) {
      setWorkView('editor');
      window.setTimeout(() => focusEditorLine(focusLine, data.content), 50);
    }
  }

  async function saveDocument(nextContent = content): Promise<void> {
    if (!activeWorkspaceId || !selectedPath || documentReadOnly) return;
    setSaving(true);
    try {
      await apiJson('/api/document', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, path: selectedPath, content: nextContent }),
      });
      setContent(nextContent);
      setSavedContent(nextContent);
      setError('');
      await refreshFiles(selectedPath);
    } finally {
      setSaving(false);
    }
  }

  async function createDocument(): Promise<void> {
    const documentPath = newDocumentPath.trim();
    if (!documentPath || !activeWorkspaceId) return;
    const starter = documentPath.endsWith('.tex')
      ? '\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\title{Untitled Research Note}\n\\author{}\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\n\n\\end{document}\n'
      : '';
    await apiJson('/api/document', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, path: documentPath, content: starter }),
    });
    setNewDocumentPath('paper.tex');
    await refreshFiles(documentPath);
    await loadDocument(documentPath);
    setWorkView('editor');
  }

  async function compileActiveDocument(): Promise<void> {
    if (!selectedPath.endsWith('.tex') || !activeWorkspaceId) return;
    setCompiling(true);
    setCompileLog('Compiling...');
    try {
      if (dirty) await saveDocument();
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, path: selectedPath, engine: compileEngine }),
      });
      const data = await response.json() as { ok?: boolean; log?: string; pdfAvailable?: boolean; error?: string };
      setCompileLog(data.log || data.error || '(no compiler output)');
      setPdfUrl(data.pdfAvailable ? pdfEndpoint(activeWorkspaceId, selectedPath) : '');
      if (!response.ok) setError('Compilation did not complete successfully. The full compiler log is available.');
      else setError('');
      if (window.innerWidth < 1180) setWorkView('log');
    } finally {
      setCompiling(false);
    }
  }

  async function runActiveDocument(): Promise<void> {
    if (!canRun || !activeWorkspaceId) return;
    setRunning(true);
    try {
      if (dirty) await saveDocument();
      const data = await apiJson<{ ok: boolean; log: string; durationMs: number }>('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, path: selectedPath }),
      });
      setCompileLog(`Run ${data.ok ? 'completed' : 'failed'} in ${(data.durationMs / 1_000).toFixed(1)}s\n\n${data.log || '(no output)'}`);
      setWorkView('log');
    } finally {
      setRunning(false);
    }
  }

  async function togglePinnedPath(documentPath: string): Promise<void> {
    const next = pinnedPaths.includes(documentPath)
      ? pinnedPaths.filter((candidate) => candidate !== documentPath)
      : [...pinnedPaths, documentPath];
    const data = await apiJson<{ pinnedPaths: string[] }>('/api/context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, pinnedPaths: next }),
    });
    setPinnedPaths(data.pinnedPaths);
  }

  async function searchWorkspace(): Promise<void> {
    if (!activeWorkspaceId || searchQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const data = await apiJson<{ results: SearchResult[] }>(`/api/search?workspaceId=${encodeURIComponent(activeWorkspaceId)}&q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(data.results);
    } finally {
      setSearching(false);
    }
  }

  async function refreshCitations(): Promise<void> {
    if (!activeWorkspaceId) return;
    setCitations(await apiJson<CitationScan>(`/api/citations?workspaceId=${encodeURIComponent(activeWorkspaceId)}`));
  }

  async function syncCitationSources(): Promise<void> {
    if (!activeWorkspaceId || syncingCitations || checkingCitations) return;
    setSyncingCitations(true);
    try {
      const scan = await apiJson<CitationScan>('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId }),
      });
      setCitations(scan);
      await refreshFiles();
      setError('');
    } finally {
      setSyncingCitations(false);
    }
  }

  async function checkCitations(): Promise<void> {
    if (!activeWorkspaceId || syncingCitations || checkingCitations) return;
    setCheckingCitations(true);
    try {
      const scan = await apiJson<CitationScan>('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, action: 'check' }),
      });
      setCitations(scan);
      await refreshFiles();
      setError('');
    } finally {
      setCheckingCitations(false);
    }
  }

  async function refreshSources(): Promise<void> {
    if (!activeWorkspaceId) return;
    setSources(await apiJson<SourceInventory>(`/api/sources?workspaceId=${encodeURIComponent(activeWorkspaceId)}`));
  }

  async function syncSources(): Promise<void> {
    if (!activeWorkspaceId || syncingSources) return;
    setSyncingSources(true);
    try {
      const inventory = await apiJson<SourceInventory>('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, action: 'refresh' }),
      });
      setSources(inventory);
      await refreshFiles();
      setError('');
    } finally {
      setSyncingSources(false);
    }
  }

  async function setSourceRole(sourcePath: string, role: SourceRole): Promise<void> {
    if (!activeWorkspaceId) return;
    const inventory = await apiJson<SourceInventory>('/api/sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, path: sourcePath, role }),
    });
    setSources(inventory);
    setError('');
  }

  async function buildSourceBrief(): Promise<void> {
    if (!sources || sources.items.length === 0) throw new Error('Add files to a sources/ folder before building a source brief.');
    const attachmentSelection = sources.items.slice(0, 8).map((source) => source.path);
    await sendChat(buildSourceBriefPrompt(sources), false, attachmentSelection, 'workspace');
  }

  async function createNewChat(scopeOverride = chatScope): Promise<string> {
    if (!activeWorkspaceId) throw new Error('Open a workspace before starting a chat.');
    if (scopeOverride === 'document' && !selectedPath) throw new Error('Open a document before starting a document chat.');
    const data = await apiJson<{ chat: ChatSession }>('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        scope: scopeOverride,
        documentPath: scopeOverride === 'document' ? selectedPath : undefined,
      }),
    });
    setActiveChatId(data.chat.id);
    setChatScope(data.chat.scope);
    setChatDocumentPath(data.chat.documentPath ?? '');
    setMessages([]);
    window.localStorage.setItem(`octave:chat:${activeWorkspaceId}`, data.chat.id);
    await refreshChats();
    setWorkView('chat');
    return data.chat.id;
  }

  async function refreshChats(): Promise<void> {
    if (!activeWorkspaceId) return;
    const data = await apiJson<{ chats: ChatSessionMeta[] }>(`/api/chats?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    setChats(data.chats);
  }

  async function renameChatSession(chat: ChatSessionMeta): Promise<void> {
    if (!activeWorkspaceId) return;
    const title = window.prompt('Rename chat', chat.title)?.trim();
    if (!title || title === chat.title) return;
    const data = await apiJson<{ chat: ChatSession }>(`/api/chats`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, chatId: chat.id, title }),
    });
    setChats((current) => current.map((item) => item.id === chat.id ? {
      ...item,
      title: data.chat.title,
      updatedAt: data.chat.updatedAt,
    } : item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (activeChatId === chat.id) await loadChat(chat.id, activeWorkspaceId, false);
    setError('');
  }

  async function deleteChatSession(chat: ChatSessionMeta): Promise<void> {
    if (!activeWorkspaceId) return;
    if (!window.confirm(`Delete the chat "${chat.title}"? This removes it from this workspace.`)) return;
    await apiJson<{ deleted: boolean }>(`/api/chats?workspaceId=${encodeURIComponent(activeWorkspaceId)}&chatId=${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
    if (activeChatId === chat.id) {
      setActiveChatId('');
      setMessages([]);
      setAttachmentPaths([]);
      setChatInput('');
      setModelRecovery(null);
      window.localStorage.removeItem(`octave:chat:${activeWorkspaceId}`);
      setWorkView('editor');
    }
    await refreshChats();
    setError('');
  }

  async function refreshReviews(): Promise<void> {
    if (!activeWorkspaceId) return;
    const data = await apiJson<{ reviews: ReviewMemoMeta[] }>(`/api/reviews?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    setReviews(data.reviews);
  }

  async function loadReviewMemo(reviewId: string): Promise<void> {
    if (!activeWorkspaceId) return;
    const data = await apiJson<{ review: ReviewMemo | null }>(`/api/reviews?workspaceId=${encodeURIComponent(activeWorkspaceId)}&reviewId=${encodeURIComponent(reviewId)}`);
    if (!data.review) throw new Error('Review memo was not found.');
    setActiveReview(data.review);
    setWorkView('memo');
    setRailOpen(false);
  }

  async function saveReviewMemo(messageIndex: number): Promise<void> {
    if (!activeWorkspaceId || !activeChatId) throw new Error('Open a saved chat before creating a review memo.');
    const message = messages[messageIndex];
    if (!message || message.role !== 'assistant' || !message.content.trim()) {
      throw new Error('Only a completed assistant response can be saved as a review.');
    }
    setSavingReviewMessageTs(message.ts);
    try {
      await apiJson<{ review: ReviewMemo; created: boolean }>('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          chatId: activeChatId,
          messageIndex,
        }),
      });
      await refreshReviews();
      setRailView('reviews');
      setError('');
    } finally {
      setSavingReviewMessageTs('');
    }
  }

  async function deleteReviewMemo(review: ReviewMemo): Promise<void> {
    if (!activeWorkspaceId) return;
    if (!window.confirm(`Delete the saved review "${review.title}"? The Markdown artifact will be removed.`)) return;
    setDeletingReview(true);
    try {
      await apiJson(`/api/reviews?workspaceId=${encodeURIComponent(activeWorkspaceId)}&reviewId=${encodeURIComponent(review.id)}`, { method: 'DELETE' });
      setActiveReview(null);
      setWorkView(activeChatId ? 'chat' : 'editor');
      await refreshReviews();
      setError('');
    } finally {
      setDeletingReview(false);
    }
  }

  async function loadChat(chatId: string, workspaceId = activeWorkspaceId, show = true): Promise<void> {
    const data = await apiJson<{ chat: ChatSession | null }>(`/api/chats?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(chatId)}`);
    if (!data.chat) throw new Error('Chat session was not found.');
    setActiveChatId(chatId);
    setChatScope(data.chat.scope);
    setChatDocumentPath(data.chat.documentPath ?? '');
    setMessages(data.chat.messages);
    setAttachmentPaths([]);
    setModelRecovery(null);
    window.localStorage.setItem(`octave:chat:${workspaceId}`, chatId);
    if (show) setWorkView('chat');
  }

  async function sendChat(
    promptOverride?: string,
    includeCitationEvidence = false,
    attachmentPathOverride?: string[],
    scopeOverride?: ChatScope,
  ): Promise<void> {
    const prompt = (promptOverride ?? chatInput).trim();
    if (!prompt || chatLoading || !activeWorkspaceId) return;

    const effectiveScope = scopeOverride ?? chatScope;
    const effectiveAttachmentPaths = attachmentPathOverride ?? attachmentPaths;
    const newChatDocumentPath = effectiveScope === 'document' ? selectedPath : '';
    const shouldCreateChat = !activeChatId || effectiveScope !== chatScope;
    const chatId = shouldCreateChat ? await createNewChat(effectiveScope) : activeChatId;
    const scopedDocumentPath = shouldCreateChat ? newChatDocumentPath : chatDocumentPath;
    const now = new Date().toISOString();
    const priorMessages = shouldCreateChat ? [] : messages;
    const pendingAttachments = effectiveAttachmentPaths
      .map((attachmentPath) => files.find((file) => file.path === attachmentPath))
      .filter((file): file is OctaveFile => Boolean(file))
      .map(toOptimisticAttachment);
    const retryAttachmentPaths = [...effectiveAttachmentPaths];
    const optimisticUser: ChatMessage = {
      ts: now,
      role: 'user',
      content: prompt,
      ...(pendingAttachments.length > 0 ? { attachments: pendingAttachments } : {}),
    };
    const optimistic: ChatMessage[] = [
      ...priorMessages,
      optimisticUser,
      { ts: now, role: 'assistant', content: '' },
    ];
    setMessages(optimistic);
    setChatInput('');
    setAttachmentPaths([]);
    setModelRecovery(null);
    setChatLoading(true);
    setWorkView('chat');
    const abort = new AbortController();
    chatAbortRef.current = abort;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          chatId,
          prompt,
          documentPath: effectiveScope === 'document' ? (scopedDocumentPath || undefined) : undefined,
          provider: providerId,
          model: modelId || undefined,
          attachmentPaths: effectiveAttachmentPaths.length > 0 ? effectiveAttachmentPaths : undefined,
          includeCitationEvidence,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Chat request failed.');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Chat provider returned no response stream.');
      const decoder = new TextDecoder();
      let assistantContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        setMessages([...priorMessages, optimisticUser, { ts: now, role: 'assistant', content: assistantContent }]);
      }
      assistantContent += decoder.decode();
      const modelError = parseModelError(assistantContent);
      if (modelError) {
        setMessages([...priorMessages, optimisticUser, { ts: now, role: 'assistant', content: modelError.assistantContent }]);
        setChatInput(prompt);
        setAttachmentPaths(retryAttachmentPaths);
        setModelRecovery({
          message: modelError.message,
          prompt,
          providerId,
          failedModel: modelId,
          attachmentPaths: retryAttachmentPaths,
          includeCitationEvidence,
        });
        setError('');
        await refreshChats();
        return;
      }
      await loadChat(chatId);
      await refreshChats();
      setError('');
    } catch (chatError) {
      if (chatError instanceof Error && chatError.name === 'AbortError') return;
      throw chatError;
    } finally {
      if (chatAbortRef.current === abort) chatAbortRef.current = null;
      setChatLoading(false);
    }
  }

  async function retryAfterModelError(): Promise<void> {
    if (!modelRecovery) return;
    const recovery = modelRecovery;
    setChatInput(recovery.prompt);
    setAttachmentPaths(recovery.attachmentPaths);
    setModelRecovery(null);
    await sendChat(recovery.prompt, recovery.includeCitationEvidence, recovery.attachmentPaths);
  }

  function stopChat(): void {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setChatLoading(false);
    setMessages((current) => {
      const last = current.at(-1);
      return last?.role === 'assistant' && !last.content ? current.slice(0, -1) : current;
    });
  }

  function changeChatScope(scope: ChatScope): void {
    if (scope === 'document' && !selectedPath) {
      showError(new Error('Open a document before starting a document chat.'));
      return;
    }
    setChatScope(scope);
    setChatDocumentPath(scope === 'document' ? selectedPath : '');
    setActiveChatId('');
    setMessages([]);
    setAttachmentPaths([]);
    setError('');
  }

  function toggleAttachment(attachmentPath: string): void {
    setAttachmentPaths((current) => {
      if (current.includes(attachmentPath)) return current.filter((path) => path !== attachmentPath);
      if (current.length >= 8) {
        showError(new Error('A chat message can include at most 8 attachments.'));
        return current;
      }
      setError('');
      return [...current, attachmentPath];
    });
  }

  async function proposeRevision(): Promise<void> {
    const instruction = chatInput.trim();
    if (!instruction || !selectedPath || !activeWorkspaceId) return;
    setRevising(true);
    try {
      if (dirty) await saveDocument();
      const proposal = await apiJson<RevisionPreview>('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          path: selectedPath,
          instruction,
          provider: providerId,
          model: modelId || undefined,
        }),
      });
      const hunks = buildDiffHunks(proposal.before, proposal.after);
      setRevision(proposal);
      setIncludedHunks(new Set(hunks.map((hunk) => hunk.id)));
      setChatInput('');
      setWorkView('review');
    } finally {
      setRevising(false);
    }
  }

  async function applyRevision(): Promise<void> {
    if (!revision) return;
    const finalContent = materializeRevision(revision.before, revision.after, revisionHunks, includedHunks);
    await saveDocument(finalContent);
    setRevision(null);
    setIncludedHunks(new Set());
    setPdfUrl('');
    setCompileLog('Revision applied. Recompile the document to refresh the PDF artifact.');
    setWorkView('editor');
  }

  function toggleHunk(hunkId: string): void {
    setIncludedHunks((current) => {
      const next = new Set(current);
      if (next.has(hunkId)) next.delete(hunkId);
      else next.add(hunkId);
      return next;
    });
  }

  function setProvider(nextProviderId: string): void {
    setProviderId(nextProviderId);
    window.localStorage.setItem('octave:provider', nextProviderId);
    const provider = providers.find((candidate) => candidate.id === nextProviderId);
    const nextModel = window.localStorage.getItem(`octave:model:${nextProviderId}`) ?? provider?.models[0]?.id ?? '';
    setModelId(nextModel);
    setModelRecovery(null);
  }

  function setModel(nextModelId: string): void {
    setModelId(nextModelId);
    window.localStorage.setItem(`octave:model:${providerId}`, nextModelId);
  }

  function openOutlineItem(item: OutlineItem): void {
    setWorkView('editor');
    window.setTimeout(() => focusEditorLine(item.line, content), 50);
  }

  function focusEditorLine(line: number, source: string): void {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = source.split(/\r?\n/);
    const targetLine = Math.max(1, Math.min(line, lines.length));
    const start = lines.slice(0, targetLine - 1).reduce((length, value) => length + value.length + 1, 0);
    const end = start + (lines[targetLine - 1]?.length ?? 0);
    editor.focus();
    editor.setSelectionRange(start, end);
    editor.scrollTop = Math.max(0, (targetLine - 5) * 24);
    if (lineGutterRef.current) lineGutterRef.current.scrollTop = editor.scrollTop;
  }

  function clearDocument(): void {
    setSelectedPath('');
    setDocumentExtension('');
    setDocumentReadOnly(false);
    setExtractionWarnings([]);
    setContent('');
    setSavedContent('');
    setPdfUrl('');
    setRevision(null);
  }

  function showError(problem: unknown): void {
    setError(problem instanceof Error ? problem.message : String(problem || 'Unknown error'));
  }

  const guard = (operation: () => Promise<void>) => () => operation().catch(showError);

  function parseModelError(content: string): { message: string; assistantContent: string } | null {
    const match = content.match(/\[Octave model error:\s*([\s\S]*?)\]\s*$/);
    if (!match) return null;
    const message = match[1]?.trim() || 'The selected model is unavailable.';
    return {
      message,
      assistantContent: [
        'The selected model is unavailable for this provider/account.',
        '',
        'Choose another model from the dropdown and retry the prompt.',
        '',
        `Technical detail: ${message}`,
      ].join('\n'),
    };
  }

  if (booting) {
    return <div className="boot-screen"><div className="brand-mark large">O</div><p>Opening the research workspace...</p></div>;
  }

  return (
    <main className="octave-shell">
      <WorkspaceRail
        open={railOpen}
        railView={railView}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        workspaceFormOpen={workspaceFormOpen}
        workspaceName={workspaceName}
        workspacePath={workspacePath}
        files={files}
        selectedPath={selectedPath}
        pinnedPaths={pinnedPaths}
        fileFilter={fileFilter}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searching={searching}
        chats={chats}
        activeChatId={activeChatId}
        reviews={reviews}
        activeReviewId={activeReview?.id ?? ''}
        outline={outline}
        citations={citations}
        sources={sources}
        syncingCitations={syncingCitations}
        checkingCitations={checkingCitations}
        syncingSources={syncingSources}
        newDocumentPath={newDocumentPath}
        onClose={() => setRailOpen(false)}
        onRailView={setRailView}
        onSelectWorkspace={(id) => loadWorkspace(id).catch(showError)}
        onToggleWorkspaceForm={() => setWorkspaceFormOpen((open) => !open)}
        onWorkspaceName={setWorkspaceName}
        onWorkspacePath={setWorkspacePath}
        onAddWorkspace={guard(addWorkspace)}
        onBrowseWorkspace={guard(browseWorkspace)}
        openingWorkspace={openingWorkspace}
        pickingWorkspace={pickingWorkspace}
        onRemoveWorkspace={(id) => removeWorkspace(id).catch(showError)}
        onFileFilter={setFileFilter}
        onOpenFile={(path, line) => loadDocument(path, activeWorkspaceId, line).catch(showError)}
        onTogglePin={(path) => togglePinnedPath(path).catch(showError)}
        onSearchQuery={setSearchQuery}
        onSearch={guard(searchWorkspace)}
        onOpenSearchResult={(result) => loadDocument(result.path, activeWorkspaceId, result.line).catch(showError)}
        onNewChat={() => createNewChat().catch(showError)}
        onOpenChat={(chatId) => loadChat(chatId).catch(showError)}
        onRenameChat={(chat) => renameChatSession(chat).catch(showError)}
        onDeleteChat={(chat) => deleteChatSession(chat).catch(showError)}
        onOpenReview={(reviewId) => loadReviewMemo(reviewId).catch(showError)}
        onOutlineItem={openOutlineItem}
        onRefreshCitations={guard(refreshCitations)}
        onSyncCitations={guard(syncCitationSources)}
        onCheckCitations={guard(checkCitations)}
        onOpenCitationSource={(path) => loadDocument(path).catch(showError)}
        onRefreshSources={guard(refreshSources)}
        onSyncSources={guard(syncSources)}
        onOpenSourceFile={(path) => loadDocument(path).catch(showError)}
        onBuildSourceBrief={guard(buildSourceBrief)}
        onSetSourceRole={(path, role) => setSourceRole(path, role).catch(showError)}
        onNewDocumentPath={setNewDocumentPath}
        onCreateDocument={guard(createDocument)}
      />

      <section className="workstation">
        <header className="topbar">
          <button className="icon-button rail-toggle" onClick={() => setRailOpen(true)} aria-label="Open workspace navigation"><Icon name="menu"/></button>
          <div className="document-heading">
            <p className="eyebrow">{activeWorkspace?.name || 'No workspace'}</p>
            <h1>{workView === 'memo' && activeReview ? activeReview.title : selectedPath || 'Choose a research document'}</h1>
          </div>
          <div className="document-status">
            <label className="ai-picker" title={providers.find((provider) => provider.id === providerId)?.setupHint}>
              <span>AI</span>
              <select value={providerId} onChange={(event) => setProvider(event.target.value)} aria-label="AI provider">
                {providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.name}{provider.available ? '' : ' — setup required'}</option>)}
              </select>
              <select value={modelId} onChange={(event) => setModel(event.target.value)} aria-label="AI model">
                {(providers.find((provider) => provider.id === providerId)?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
              </select>
            </label>
            {desktopProviderSettings && (
              <button className="icon-button provider-settings-button" onClick={() => setProviderSettingsOpen(true)} aria-label="Open AI provider settings" title="AI provider settings">
                <Icon name="settings" size={16}/>
              </button>
            )}
            <span className={`save-state ${dirty ? 'dirty' : ''}`}>{saving ? 'Saving' : dirty ? 'Unsaved changes' : selectedPath ? 'Saved locally' : 'Local-first'}</span>
            {canRun && <button className="button button-quiet" disabled={running} onClick={guard(runActiveDocument)}><Icon name="terminal" size={15}/>{running ? 'Running...' : 'Run'}</button>}
            <button className="button button-quiet review-button" disabled={!selectedPath || chatLoading} onClick={() => sendChat(REVIEW_PROMPT, true).catch(showError)}><Icon name="spark" size={15}/>Review paper</button>
            <button className="button button-quiet submission-button" disabled={!activeWorkspaceId || submissionBusy !== null} onClick={() => openSubmissionDesk().catch(showError)}><Icon name="file" size={15}/>Submit</button>
            <button className="button button-primary" disabled={!selectedPath || !dirty || saving || documentReadOnly} onClick={guard(() => saveDocument())}>{documentReadOnly ? 'Read only' : saving ? 'Saving...' : 'Save'}</button>
          </div>
        </header>

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        {!activeWorkspaceId ? (
          <WelcomePanel
            workspaceName={workspaceName}
            workspacePath={workspacePath}
            onName={setWorkspaceName}
            onPath={setWorkspacePath}
            onOpen={guard(addWorkspace)}
            onBrowse={guard(browseWorkspace)}
            opening={openingWorkspace}
            picking={pickingWorkspace}
          />
        ) : (
          <>
            <nav className="work-tabs" aria-label="Document views">
              {([
                ['editor', 'Editor'],
                ['chat', 'Chat'],
                ['review', revision ? `Review (${revisionHunks.length})` : 'Review'],
                ...(activeReview ? [['memo', 'Memo'] as [WorkView, string]] : []),
                ['submission', 'Submission'],
                ['log', 'Log'],
                ['pdf', 'PDF'],
              ] as Array<[WorkView, string]>).map(([view, label]) => (
                <button key={view} className={workView === view ? 'active' : ''} onClick={() => view === 'submission' ? openSubmissionDesk().catch(showError) : setWorkView(view)}>{label}</button>
              ))}
            </nav>

            <div className="workspace-grid">
              <section className="primary-pane">
                {workView === 'editor' && (
                  selectedPath ? (
                    <div className="editor-shell">
                      <div className="line-gutter" ref={lineGutterRef} aria-hidden="true">
                        {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
                      </div>
                      <textarea
                        ref={editorRef}
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        onScroll={(event) => {
                          if (lineGutterRef.current) lineGutterRef.current.scrollTop = event.currentTarget.scrollTop;
                        }}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                            event.preventDefault();
                            saveDocument().catch(showError);
                          }
                        }}
                        spellCheck={false}
                        readOnly={documentReadOnly}
                        aria-label="Research document editor"
                      />
                      <footer className="editor-status"><span>{documentExtension || 'document'}{documentReadOnly ? ' · extracted preview' : ''}</span><span>{lineCount} lines · {wordCount.toLocaleString()} words</span></footer>
                      {extractionWarnings.length > 0 && <div className="extraction-warning" role="status">{extractionWarnings.join(' ')}</div>}
                    </div>
                  ) : <DocumentEmpty onCreate={() => setRailView('files')} />
                )}

                {workView === 'chat' && (
                  <ChatPanel
                    messages={messages}
                    savedReviewMessageIndexes={savedReviewMessageIndexes}
                    savingReviewMessageTs={savingReviewMessageTs}
                    files={files}
                    attachmentPaths={attachmentPaths}
                    input={chatInput}
                    loading={chatLoading}
                    revising={revising}
                    canRevise={!documentReadOnly}
                    selectedPath={selectedPath}
                    scope={chatScope}
                    documentPath={chatDocumentPath || selectedPath}
                    providerId={providerId}
                    modelId={modelId}
                    modelRecovery={modelRecovery}
                    providers={providers}
                    onInput={setChatInput}
                    onProvider={setProvider}
                    onModel={setModel}
                    onRetryModelError={() => retryAfterModelError().catch(showError)}
                    onDismissModelError={() => setModelRecovery(null)}
                    onScope={changeChatScope}
                    onToggleAttachment={toggleAttachment}
                    onRemoveAttachment={(attachmentPath) => setAttachmentPaths((current) => current.filter((path) => path !== attachmentPath))}
                    onSaveReview={(messageIndex) => saveReviewMemo(messageIndex).catch(showError)}
                    onSend={() => sendChat().catch(showError)}
                    onProposeRevision={() => proposeRevision().catch(showError)}
                    onStop={stopChat}
                  />
                )}

                {workView === 'review' && (
                  <RevisionPanel
                    revision={revision}
                    includedHunks={includedHunks}
                    busy={saving}
                    onToggleHunk={toggleHunk}
                    onIncludeAll={() => setIncludedHunks(new Set(revisionHunks.map((hunk) => hunk.id)))}
                    onExcludeAll={() => setIncludedHunks(new Set())}
                    onApply={() => applyRevision().catch(showError)}
                    onDiscard={() => { setRevision(null); setIncludedHunks(new Set()); }}
                  />
                )}

                {workView === 'memo' && (
                  <ReviewMemoPanel
                    review={activeReview}
                    deleting={deletingReview}
                    onOpenSourceChat={(chatId) => loadChat(chatId).catch(showError)}
                    onDelete={(review) => deleteReviewMemo(review).catch(showError)}
                  />
                )}

                {workView === 'submission' && (
                  <SubmissionPanel
                    manifest={submissionManifest}
                    preflight={submissionPreflight}
                    packages={submissionPackages}
                    files={files}
                    workspaceId={activeWorkspaceId}
                    busy={submissionBusy}
                    onManifest={setSubmissionManifest}
                    onAction={(action) => runSubmissionAction(action).catch(showError)}
                  />
                )}

                {workView === 'log' && (
                  <div className="log-pane">
                    <header className="pane-header"><div><p className="eyebrow">Process output</p><h2>Compile and run log</h2></div></header>
                    <pre>{compileLog || 'Compile a TeX document or run a source file to see process output.'}</pre>
                  </div>
                )}

                {workView === 'pdf' && (
                  <div className="mobile-pdf-view">
                    <PdfPane pdfUrl={pdfUrl} selectedPath={selectedPath} compiling={compiling} engine={compileEngine} onEngineChange={setCompileEngine} onCompile={guard(compileActiveDocument)} />
                  </div>
                )}
              </section>

              <PdfPane
                pdfUrl={pdfUrl}
                selectedPath={selectedPath}
                compiling={compiling}
                engine={compileEngine}
                onEngineChange={setCompileEngine}
                onCompile={guard(compileActiveDocument)}
              />
            </div>
          </>
        )}
      </section>
      {desktopProviderSettings && (
        <ProviderSettingsDialog
          open={providerSettingsOpen}
          settings={desktopProviderSettings}
          saving={savingProviderSettings}
          workspaceReady={Boolean(activeWorkspaceId || workspaces.length)}
          onClose={() => setProviderSettingsOpen(false)}
          onSave={saveDesktopProviderSettings}
        />
      )}
    </main>
  );
}

function WelcomePanel({
  workspaceName,
  workspacePath,
  onName,
  onPath,
  onOpen,
  onBrowse,
  opening,
  picking,
}: {
  workspaceName: string;
  workspacePath: string;
  onName: (value: string) => void;
  onPath: (value: string) => void;
  onOpen: () => void;
  onBrowse: () => void;
  opening: boolean;
  picking: boolean;
}) {
  return (
    <div className="welcome-panel">
      <div className="welcome-copy">
        <p className="eyebrow">Local research, properly instrumented</p>
        <h2>Your paper stays the center of the room.</h2>
        <p>Open an existing research folder. Octave will discover supported documents, keep conversations beside them, compile LaTeX, and stage model-proposed edits for review.</p>
        <ul><li>No upload step</li><li>No proprietary project format</li><li>No write before review</li></ul>
      </div>
      <div className="welcome-form">
        <span className="welcome-number">01</span>
        <h3>Open a local workspace</h3>
        <label>Name <small>optional</small><input value={workspaceName} onChange={(event) => onName(event.target.value)} placeholder="Finite-depth geometry" /></label>
        <label>Project folder<div className="path-picker"><input value={workspacePath} onChange={(event) => onPath(event.target.value)} placeholder="Choose a folder or paste its path" /><button className="button button-secondary" disabled={picking} onClick={onBrowse}>{picking ? 'Choosing…' : 'Browse…'}</button></div></label>
        <button className="button button-primary full-width" disabled={!workspacePath.trim() || opening} onClick={onOpen}>{opening ? 'Opening workspace…' : 'Open workspace'}</button>
        <p>Octave writes only its chat and context state to a hidden `.octave` folder inside the workspace.</p>
      </div>
    </div>
  );
}

function DocumentEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-pane document-empty">
      <Icon name="book" size={30}/>
      <h3>This workspace has no active document</h3>
      <p>Create a TeX, Markdown, text, Python, or R file from the Files rail.</p>
      <button className="button button-secondary" onClick={onCreate}>Open Files</button>
    </div>
  );
}

function pdfEndpoint(workspaceId: string, documentPath: string): string {
  return `/api/pdf?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(documentPath)}&t=${Date.now()}`;
}

function toOptimisticAttachment(file: OctaveFile): ChatAttachment {
  const kind: ChatAttachment['kind'] = file.extension === '.pdf'
    ? 'pdf'
    : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(file.extension)
      ? 'image'
      : file.editable ? 'text' : 'office';
  return {
    path: file.path,
    name: file.name,
    kind,
    content: '',
    warnings: [],
    sourceBytes: file.size,
    truncated: false,
  };
}

function buildSourceBriefPrompt(inventory: SourceInventory): string {
  const itemLines = inventory.items.slice(0, 24).map((source) => (
    `- ${source.path} — ${source.role}${source.roleSource === 'manual' ? ' (manual)' : ''}`
  ));
  return [
    'Build a source-grounded research brief from the attached source files and the project source inventory.',
    'Start with what the current source shelf contains, grouped as primary sources, secondary sources, archive/data, and unknown.',
    'Answer the research question only as far as the attached/project sources support it.',
    'Use exact file paths and page or line cues when available.',
    'Separate: (1) what the sources directly establish, (2) reasonable inference, (3) uncertainty, and (4) missing sources to add next.',
    '',
    `Inventory generated at: ${inventory.generatedAt}`,
    `Inventory file: ${inventory.inventoryPath}`,
    `Summary: ${inventory.summary.primary} primary, ${inventory.summary.secondary} secondary, ${inventory.summary.dataset_archive} archive/data, ${inventory.summary.unknown} unknown.`,
    '',
    'Inventory sample:',
    ...itemLines,
    itemLines.length < inventory.items.length ? `- ... ${inventory.items.length - itemLines.length} additional sources omitted from this prompt sample` : '',
    '',
    'Research question or topic: ',
  ].filter(Boolean).join('\n');
}

async function apiJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
