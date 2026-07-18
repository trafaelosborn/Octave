'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatScope, OctaveFile, ProviderStatus } from '../lib/client-types';
import { Icon } from './Icon';
import { MarkdownMessage } from './MarkdownMessage';

const MAX_CHAT_ATTACHMENTS = 8;

export function ChatPanel({
  messages,
  files,
  attachmentPaths,
  input,
  loading,
  revising,
  canRevise,
  selectedPath,
  scope,
  documentPath,
  providerId,
  modelId,
  providers,
  onInput,
  onProvider,
  onModel,
  onScope,
  onToggleAttachment,
  onRemoveAttachment,
  onSend,
  onProposeRevision,
  onStop,
}: {
  messages: ChatMessage[];
  files: OctaveFile[];
  attachmentPaths: string[];
  input: string;
  loading: boolean;
  revising: boolean;
  canRevise: boolean;
  selectedPath: string;
  scope: ChatScope;
  documentPath: string;
  providerId: string;
  modelId: string;
  providers: ProviderStatus[];
  onInput: (value: string) => void;
  onProvider: (providerId: string) => void;
  onModel: (modelId: string) => void;
  onScope: (scope: ChatScope) => void;
  onToggleAttachment: (path: string) => void;
  onRemoveAttachment: (path: string) => void;
  onSend: () => void;
  onProposeRevision: () => void;
  onStop: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [attachmentFilter, setAttachmentFilter] = useState('');
  const activeProvider = providers.find((provider) => provider.id === providerId);
  const visibleFiles = useMemo(() => {
    const query = attachmentFilter.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [attachmentFilter, files]);
  const pendingFiles = attachmentPaths
    .map((attachmentPath) => files.find((file) => file.path === attachmentPath))
    .filter((file): file is OctaveFile => Boolean(file));

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: loading ? 'auto' : 'smooth' });
  }, [messages, loading]);

  return (
    <div className="chat-panel">
      <div className="chat-context-strip">
        <div>
          <Icon name="spark" size={15}/>
          <span>{scope === 'document' ? `Document: ${documentPath || selectedPath}` : 'Project conversation'}</span>
        </div>
        <div className="chat-controls">
          <label className="scope-picker">
            <span>Scope</span>
            <select value={scope} onChange={(event) => onScope(event.target.value as ChatScope)} aria-label="Chat scope">
              <option value="document" disabled={!selectedPath}>Document</option>
              <option value="workspace">Project</option>
            </select>
          </label>
          <label className="provider-picker">
            <span className={`provider-dot ${activeProvider?.available ? 'online' : 'offline'}`} />
            <select value={providerId} onChange={(event) => onProvider(event.target.value)} aria-label="Model provider">
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.available}>
                  {provider.name}{provider.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
            <select value={modelId} onChange={(event) => onModel(event.target.value)} aria-label="Model">
              {(activeProvider?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="message-list" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <span className="chat-welcome-mark"><Icon name="spark" size={22}/></span>
            <h3>Think with the document</h3>
            <p>Ask about an argument, trace an assumption, compare pinned sources, or prepare a reviewable revision.</p>
            <div className="prompt-suggestions">
              <button onClick={() => onInput('Give me a rigorous structural review of this document.')}>Structural review</button>
              <button onClick={() => onInput('Identify the weakest assumption and explain why it matters.')}>Find the weak assumption</button>
              <button onClick={() => onInput('Summarize the contribution without overstating what is proved.')}>Calibrate the claim</button>
            </div>
          </div>
        ) : messages.map((message, index) => (
          <article className={`message message-${message.role}`} key={`${message.ts}-${index}`}>
            <div className="message-avatar">{message.role === 'user' ? 'You' : 'O'}</div>
            <div className="message-body">
              <header><span>{message.role === 'user' ? 'You' : 'Octave'}</span><time>{formatTime(message.ts)}</time></header>
              {message.role === 'assistant'
                ? message.content
                  ? <MarkdownMessage content={message.content}/>
                  : <ThinkingIndicator />
                : <p>{message.content}</p>}
              {message.attachments && message.attachments.length > 0 && (
                <div className="message-attachments" aria-label="Message attachments">
                  {message.attachments.map((attachment) => (
                    <span className="attachment-chip" key={attachment.path} title={attachment.path}>
                      <Icon name="file" size={13}/>
                      <span>{attachment.name}</span>
                      {attachment.truncated && <small>truncated</small>}
                    </span>
                  ))}
                  {message.attachments.flatMap((attachment) => attachment.warnings).map((warning, warningIndex) => (
                    <p className="attachment-warning" key={`${warning}-${warningIndex}`}>{warning}</p>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="composer-shell">
        {attachmentPickerOpen && (
          <div className="attachment-picker">
            <header>
              <div><strong>Attach project files</strong><span>{attachmentPaths.length}/{MAX_CHAT_ATTACHMENTS}</span></div>
              <button type="button" className="button button-quiet" onClick={() => setAttachmentPickerOpen(false)}>Done</button>
            </header>
            <input
              type="search"
              value={attachmentFilter}
              onChange={(event) => setAttachmentFilter(event.target.value)}
              placeholder="Filter project files..."
              aria-label="Filter attachment files"
            />
            <div className="attachment-file-list">
              {visibleFiles.length === 0 ? <p>No supported project files found.</p> : visibleFiles.map((file) => {
                const selected = attachmentPaths.includes(file.path);
                const limitReached = attachmentPaths.length >= MAX_CHAT_ATTACHMENTS && !selected;
                return (
                  <label className={limitReached ? 'disabled' : ''} key={file.path}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={limitReached}
                      onChange={() => onToggleAttachment(file.path)}
                    />
                    <Icon name="file" size={14}/>
                    <span><strong>{file.name}</strong><small>{file.path} · {formatBytes(file.size)}</small></span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {pendingFiles.length > 0 && (
          <div className="pending-attachments" aria-label="Pending attachments">
            {pendingFiles.map((file) => (
              <span className="attachment-chip" key={file.path} title={file.path}>
                <Icon name="file" size={13}/>
                <span>{file.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(file.path)} aria-label={`Remove ${file.name}`}>
                  <Icon name="close" size={11}/>
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!loading && input.trim()) onSend();
            }
          }}
          placeholder={selectedPath ? 'Ask about the document...' : 'Ask about the workspace...'}
          rows={3}
        />
        <div className="composer-footer">
          <span>Enter to send · Shift+Enter for a new line</span>
          <div>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setAttachmentPickerOpen((open) => !open)}
              aria-expanded={attachmentPickerOpen}
              title="Attach files to this message"
            >
              <Icon name="file" size={15}/>Attach{attachmentPaths.length > 0 ? ` (${attachmentPaths.length})` : ''}
            </button>
            <button
              className="button button-quiet"
              onClick={onProposeRevision}
              disabled={!canRevise || !selectedPath || !input.trim() || loading || revising}
              title="Generate a complete document proposal, then review changes before writing"
            >
              <Icon name="code" size={15}/>{revising ? 'Drafting...' : 'Propose edit'}
            </button>
            {loading ? (
              <button className="button button-danger" onClick={onStop}>Stop</button>
            ) : (
              <button className="button button-primary" onClick={onSend} disabled={!input.trim()}>Send</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return <div className="thinking" aria-label="Octave is thinking"><i/><i/><i/></div>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
