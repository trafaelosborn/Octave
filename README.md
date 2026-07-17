# Octave

Octave is a local-first research workstation for writing, interrogating, revising, and compiling technical documents. It puts a source editor, persistent project conversations, reviewable model edits, citation checks, process logs, and a live PDF beside the same ordinary files.

It began as the research environment inside [Doris](https://github.com/trafaelosborn) and is now an independent application and TypeScript toolkit.

> **Status:** Active early release. The complete standalone workstation is usable today; desktop packaging and additional model providers remain future work.

## What it does

- Opens existing local folders without importing or converting them.
- Edits TeX, BibTeX, Markdown, text, Python, R, and LaTeX support files.
- Keeps research chats at project scope while attaching the active document and pinned files at send time.
- Streams responses from local Ollama models or Anthropic. An offline demo provider exercises the interface without credentials.
- Produces document-wide edit proposals as selectable diff hunks. Nothing is written before review.
- Compiles LaTeX with pdfLaTeX, LuaLaTeX, or Tectonic and keeps the PDF visible beside the source.
- Audits citation keys against workspace BibTeX files.
- Searches the workspace, extracts a LaTeX outline, and runs Python or R files into a bounded process log.
- Constrains file targets for reads, writes, context loading, compilation, and execution to the selected workspace.

## Run the workstation

Requirements:

- Node.js 20 or newer
- Optional: [Ollama](https://ollama.com/) for local inference
- Optional: an Anthropic API key
- Optional: `pdflatex`, `lualatex`, or `tectonic` for PDF compilation
- Optional: Python or R to run matching source files

```bash
git clone https://github.com/trafaelosborn/Octave.git
cd Octave
npm install
npm run dev
```

Open `http://127.0.0.1:3000` and choose any local research folder. Octave binds to loopback by default so its file APIs are not exposed to the local network. To open the included example immediately:

```powershell
$env:OCTAVE_ROOT = "$PWD\examples\demo-workspace"
npm.cmd run dev
```

On macOS or Linux:

```bash
OCTAVE_ROOT="$PWD/examples/demo-workspace" npm run dev
```

Workspace registrations live in `~/.octave/workspaces.json`. Per-project chats and pinned-context state live under the selected folder's `.octave/` directory.

## Model providers

Octave discovers providers at startup:

- **Offline demo:** always available; useful for exploring the workflow without model access.
- **Ollama:** available when an Ollama server responds at `OLLAMA_BASE_URL`, defaulting to `http://127.0.0.1:11434`.
- **Anthropic:** available when `ANTHROPIC_API_KEY` is set.

Copy `.env.example` to `.env.local` to set persistent local defaults. The selected provider determines where document context is processed.

## Reviewable revisions

The revision path is deliberately separate from ordinary chat:

1. Describe the change in Chat and choose **Propose edit**.
2. Octave asks the selected model for a complete revised document.
3. The Review view presents independent diff hunks.
4. Include or exclude hunks, then apply the selected set.

The source file is not modified until step four.

## CLI and library

The UI is backed by a separately exportable core. Build it with:

```bash
npm run build:lib
node dist/cli.js files examples/demo-workspace
```

Commands can also run directly from TypeScript during development:

```bash
npx tsx src/cli.ts chat "Stress-test the central claim" --workspace examples/demo-workspace --document paper.tex
npx tsx src/cli.ts compile paper.tex --workspace examples/demo-workspace --engine pdflatex
```

Library usage:

```ts
import { OllamaProvider, createChat, sendChatMessage } from '@trafaelosborn/octave';

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

## Architecture

```text
app/
  api/         workspace, document, chat, compile, search, citation, and run routes
  components/  editor workstation, chat, PDF, navigation, and revision review
  lib/         workspace registry, context state, diffs, outline, and citation audit
src/
  core/        safe paths, context assembly, chat orchestration, LaTeX compilation
  providers/   streaming Ollama and Anthropic adapters
  storage/     workspace-local conversation persistence
  cli.ts       command-line interface over the reusable core
```

Octave keeps conversation scope intentionally simple: a chat belongs to a workspace. The currently open document and pinned files are bounded context attached at send time, not separate chat types.

## Privacy and safety

- Ollama requests go only to the configured server, which defaults to `127.0.0.1`.
- Anthropic requests send selected document context and conversation messages to Anthropic's API.
- Existing file targets are checked after symbolic-link resolution.
- New files can be created only under an existing, resolved workspace directory.
- Executable source is limited to Python and R, runs without a shell, and has a timeout.
- Python and R execution is a convenience feature, not a sandbox. Run only code you trust.
- Generated chat, context, build, and dependency directories are excluded from workspace discovery.

See [SECURITY.md](SECURITY.md) for reporting and boundary details.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

`npm run check` runs strict TypeScript validation, the complete test suite, the reusable library build, and a production Next.js build. GitHub Actions runs the same validation for every pull request.

## Roadmap

- OpenAI-compatible provider support
- Richer bibliography workflows
- Desktop packaging
- Cross-platform folder picker integration

This project is not affiliated with GNU Octave. The name comes from its origin as a research workspace within Doris.

## License

MIT
