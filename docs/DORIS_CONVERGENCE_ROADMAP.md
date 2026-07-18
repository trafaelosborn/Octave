# Doris convergence roadmap

This roadmap tracks research-workstation capabilities that should move from Doris into standalone Octave without importing Doris-specific coupling or its monolithic UI implementation.

## Delivery principles

- Ship each capability as a focused, reviewable change with tests.
- Preserve Octave's local-first storage, bounded workspace access, and provider-neutral core.
- Introduce integration hooks for Doris-specific services instead of making them standalone dependencies.

## Capability sequence

1. **Project and document chat scopes** — implemented
   - Conversations explicitly target either the whole workspace or a document fixed at creation time.
   - Scope is persisted in chat metadata, enforced during context assembly, and visible in chat history.

2. **Durable session history** — implemented
   - Current state: workspace-local sessions are atomically stored under `.octave/chats/`, sorted by recent activity, reloadable through the API and Chats rail, and resilient to malformed neighboring files.
   - Remaining hardening: expose rename/delete controls in the UI, preserve interrupted streaming responses where useful, and add an export/import path.

3. **File attachments**
   - Attach bounded local files to an individual chat turn without permanently pinning them.
   - Enforce size, type, and workspace-boundary limits.

4. **Saved review memos**
   - Persist serious review outputs as named Markdown artifacts separate from ordinary chat.
   - Link reviews to their source document and chat session.

5. **Line-level revision decisions**
   - Accept or reject individual changed lines within a proposed hunk while keeping the resulting document valid.

6. **Automatic recompilation after revisions**
   - Recompile applicable TeX documents after accepted or rejected revision changes.
   - Treat compilation failure as reviewable process state, not a fatal UI error.

7. **Citation retrieval and source status**
   - Track bibliography metadata, missing keys, missing source files, and metadata-only references.
   - Keep retrieval optional and reviewable.

8. **Visual document maps**
   - Generate and persist navigable maps of claims, sections, dependencies, and cited sources.

9. **Mobile workspace controls**
   - Provide compact project, file, chat, context, and compilation controls without reducing desktop functionality.

10. **Whiteboards**
    - Add project-scoped visual working surfaces linked to documents and conversations.

11. **Optional external integration hooks**
    - Define interfaces for broader conversation memory and text-to-speech.
    - Keep Doris memory and TTS as optional adapters rather than standalone Octave requirements.
