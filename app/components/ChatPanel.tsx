'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage, ChatScope, ProviderStatus } from '../lib/client-types';
import { Icon } from './Icon';
import { MarkdownMessage } from './MarkdownMessage';

export function ChatPanel({
  messages,
  input,
  loading,
  revising,
  selectedPath,
  scope,
  documentPath,
  providerId,
  providers,
  onInput,
  onProvider,
  onScope,
  onSend,
  onProposeRevision,
  onStop,
}: {
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  revising: boolean;
  selectedPath: string;
  scope: ChatScope;
  documentPath: string;
  providerId: string;
  providers: ProviderStatus[];
  onInput: (value: string) => void;
  onProvider: (providerId: string) => void;
  onScope: (scope: ChatScope) => void;
  onSend: () => void;
  onProposeRevision: () => void;
  onStop: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeProvider = providers.find((provider) => provider.id === providerId);

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
            </div>
          </article>
        ))}
      </div>

      <div className="composer-shell">
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
              className="button button-quiet"
              onClick={onProposeRevision}
              disabled={!selectedPath || !input.trim() || loading || revising}
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
