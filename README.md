# Octave

Octave is a local-first TypeScript toolkit for working with research documents. It combines workspace-scoped file access, persistent research conversations, pluggable language-model providers, and multi-pass LaTeX compilation behind a small, testable API and command-line interface.

Octave began as the research workspace inside Doris, a personal local operating system. This repository is the independent, reusable core extracted from that larger application.

> **Status:** Octave is an early-stage core and CLI, not yet the complete graphical research workstation. The document editor, review UI, and PDF workspace are on the roadmap.

## Why Octave

- **Local-first state:** chats are stored inside the selected workspace under `.octave/chats/`.
- **Explicit file boundary:** document reads and compilation are constrained to the workspace root.
- **Provider-independent:** use a local Ollama model or Anthropic through the same streaming interface.
- **Document-aware chat:** the current document and pinned files are loaded as bounded context when a message is sent.
- **Real LaTeX behavior:** `pdflatex` and `lualatex` can run multiple passes when references require it; Tectonic is also supported.
- **Embeddable:** the core, provider, and storage layers are exported separately for use in another web or desktop application.

## Quick start

Requirements:

- Node.js 20 or newer
- Ollama for local chat, or an Anthropic API key
- Optional: `pdflatex`, `lualatex`, or `tectonic` for document compilation

```bash
git clone https://github.com/trafaelosborn/Octave.git
cd Octave
npm install
npm run build
node dist/cli.js files path/to/research-project
```

During development, commands can run directly from TypeScript:

```bash
npx tsx src/cli.ts files path/to/research-project
npx tsx src/cli.ts chat "Summarize the main claim" --workspace path/to/research-project --document paper.tex
npx tsx src/cli.ts compile paper.tex --workspace path/to/research-project --engine pdflatex
```

The chat command uses Ollama by default. To use Anthropic:

```bash
set ANTHROPIC_API_KEY=your-key
npx tsx src/cli.ts chat "Stress-test section three" --workspace . --document paper.tex --provider anthropic
```

On macOS or Linux, use `export ANTHROPIC_API_KEY=your-key` instead.

## Library example

```ts
import {
  OllamaProvider,
  createChat,
  sendChatMessage,
} from '@trafaelosborn/octave';

const workspaceRoot = '/path/to/research-project';
const chat = await createChat(workspaceRoot, 'Proof review');
const provider = new OllamaProvider({ model: 'llama3.1' });

const result = await sendChatMessage({
  workspaceRoot,
  chatId: chat.id,
  userMessage: 'Where is the compactness assumption used?',
  provider,
  currentDocumentPath: 'paper.tex',
  pinnedFiles: ['notes.md'],
});

console.log(result.assistantMessage.content);
```

Run the included offline example with:

```bash
npm run demo
```

## Architecture

```text
src/
  core/       safe paths, document context, chat orchestration, LaTeX compilation
  providers/  streaming LLM adapters
  storage/    workspace-local chat persistence
  cli.ts      runnable interface over the core
```

Octave deliberately keeps conversation scope simple: chats belong to a workspace. The currently open document and any pinned files are context attached at send time, not separate kinds of chat.

## Privacy and safety

The selected provider determines where inference happens:

- **Ollama:** requests go only to the configured Ollama server, which defaults to `127.0.0.1`.
- **Anthropic:** selected document content and conversation messages are sent to Anthropic's API.

Paths supplied by users are validated against the workspace root. Existing files are also checked after symbolic-link resolution. See [SECURITY.md](SECURITY.md) for details.

## Development

```bash
npm install
npm run check
```

`npm run check` runs the strict TypeScript check, the test suite, and the production build. GitHub Actions runs the same validation on pushes and pull requests.

## Roadmap

- A standalone document editor with reviewable AI-proposed edits
- PDF preview and compilation logs in the same workspace
- OpenAI-compatible provider support
- Citation and bibliography workflows
- Desktop packaging

## Name

This project is not affiliated with GNU Octave. The name comes from its origin as a research workspace within Doris.

## License

MIT
