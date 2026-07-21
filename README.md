# Octave

Octave is a local-first research workstation for writing, interrogating, revising, and compiling technical documents. It puts a source editor, persistent project conversations, reviewable model edits, citation checks, process logs, and a live PDF beside the same ordinary files.

It began as the research environment inside [Doris](https://github.com/trafaelosborn) and is now an independent application and TypeScript toolkit.

> **Status:** Active early release. The workstation is usable today, and a Windows-first Electron developer build is available. Signed public installers remain future work.

## What it does

- Opens existing local folders without importing or converting them.
- Edits TeX, BibTeX, Markdown, structured text, Python, R, JavaScript, TypeScript, and LaTeX support files.
- Extracts read-only research context from PDF, Word, Excel, PowerPoint, OpenDocument, and RTF files with explicit limits and warnings.
- Keeps durable project and document chats, with document conversations fixed to their source file.
- Attaches up to eight supported project files to an individual message as bounded, durable extraction snapshots.
- Saves completed model responses as linked Markdown review memos that remain readable outside Octave.
- Streams responses from local Ollama models, command-line AI tools, Anthropic, OpenAI, or xAI/Grok. An offline demo provider exercises the interface without credentials.
- Produces document-wide edit proposals as selectable diff hunks. Nothing is written before review.
- Compiles LaTeX with pdfLaTeX, LuaLaTeX, or Tectonic and keeps the PDF visible beside the source.
- Audits citation keys, retrieves legitimate open full text when available, and builds a source-bound evidence corpus under `citations/`.
- Preflights a paper for submission and builds a bounded upload bundle with portal metadata, PDF, TeX dependencies, supplements, reports, and checksums.
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

### Desktop development

Launch the same workstation in its Electron shell:

```bash
npm run desktop:dev
```

Build an unsigned Windows installer and portable ZIP under `desktop/app/out/make/`:

```bash
npm run desktop:make
```

The desktop shell starts Octave's server privately on a random loopback port and replaces the browser folder-picker fallback with a native system dialog. See [docs/DESKTOP.md](docs/DESKTOP.md) for architecture, release limitations, and packaging details.

Workspace registrations live in `~/.octave/workspaces.json`. Per-project chats, saved review memos, and pinned-context state live under the selected folder's `.octave/` directory.

To enable DOI open-access discovery, set `OCTAVE_SCHOLARLY_EMAIL` to a real contact address. Citation retrieval remains an explicit **Fetch sources** action; Octave never bypasses publisher access controls. Closed or unresolved papers are placed in a manual queue.

## Model providers

Octave discovers providers at startup:

- **Offline demo:** always available; useful for exploring the workflow without model access.
- **Ollama:** available when an Ollama server responds at `OLLAMA_BASE_URL`, defaulting to `http://127.0.0.1:11434`.
- **Command-line AI:** available when `OCTAVE_CLI_COMMAND` names an installed executable. The desktop setup shows common CLI connectors, detects whether they are installed, opens that tool's sign-in flow in a terminal, and keeps command/path details tucked under advanced settings. Octave passes the assembled research prompt to stdin unless `OCTAVE_CLI_ARGS` contains `{prompt}`.
- **Anthropic:** available when `ANTHROPIC_API_KEY` is set.
- **OpenAI:** available when `OPENAI_API_KEY` is set.
- **xAI / Grok:** available when `XAI_API_KEY` is set.

The Electron app opens provider setup on first run. It can save OpenAI, xAI, and Anthropic keys with operating-system-backed encryption, configure Ollama, choose and sign into a command-line AI tool, and choose default models without exposing saved keys back to the renderer. Use the settings button beside the AI picker to change them later; Octave restarts its private server to apply changes.

Browser and CLI users can copy `.env.example` to `.env.local` to set persistent local defaults. Existing environment variables remain valid in Electron when a provider has no saved desktop key. The selected provider determines where document context is processed.

## Reviewable revisions

The revision path is deliberately separate from ordinary chat:

1. Describe the change in Chat and choose **Propose edit**.
2. Octave asks the selected model for a complete revised document.
3. The Review view presents independent diff hunks.
4. Include or exclude hunks, then apply the selected set.

The source file is not modified until step four.

## Submission Desk

Choose **Submit** in the workstation to prepare an upload set without copying the entire workspace. Octave stores reusable portal metadata in `.octave/submission.json`, follows local TeX dependencies, checks the compiled PDF and bibliography, scans text sources for likely credentials and draft markers, and adds profile-specific checks for anonymous conferences or arXiv.

A successful package is written under `.octave/submissions/` with the final PDF, a source ZIP when applicable, selected supplements, the manifest, a preflight report, SHA-256 checksums, and a downloadable bundle. Authorship approval, conflicts, funding, ethics, licensing, and the final portal action remain explicit human decisions. Octave does not claim that a generic package satisfies an unconfigured venue's current rules.

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

Use `--provider cli` to route Octave through an installed AI command instead of a direct API:

```bash
OCTAVE_CLI_COMMAND=codex OCTAVE_CLI_ARGS="exec -" npx tsx src/cli.ts chat "Review the methods section" --workspace examples/demo-workspace --document paper.tex --provider cli
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
  api/         workspace, document, chat, compile, search, citation, submission, and run routes
  components/  editor workstation, chat, PDF, navigation, and revision review
  lib/         workspace registry, context state, diffs, outline, and citation audit
desktop/
  app/         Electron main process, secure preload bridge, and Forge configuration
  *.cjs        desktop development and standalone-runtime preparation scripts
src/
  core/        safe paths, context assembly, chat orchestration, LaTeX compilation
  providers/   streaming Ollama and Anthropic adapters
  storage/     workspace-local conversation persistence
  cli.ts       command-line interface over the reusable core
```

Octave persists both project chats and document chats inside the workspace. Document chats remain bound to their source document; project chats use explicitly pinned files as bounded context. Message attachments are separate from pinned context: their extracted snapshots stay on the specific user turn that used them, capped at 25 MB of combined source data and 60,000 extracted characters.

Fetched citation originals, extracted Markdown, JSONL text chunks, provenance, and the claim-to-source audit stay in the visible workspace `citations/` directory. The **Review paper** action includes bounded evidence packets when they exist and tells the model when evidence is missing or stale. A lexical candidate passage is a review lead, not an automatic finding that a claim is supported.

## Privacy and safety

- Ollama requests go only to the configured server, which defaults to `127.0.0.1`.
- Anthropic requests send selected document context and conversation messages to Anthropic's API.
- Existing file targets are checked after symbolic-link resolution.
- Citation downloads require public HTTPS targets, reject local/private destinations and credentials, revalidate redirects, and enforce time and size limits.
- New files can be created only under an existing, resolved workspace directory.
- Executable source is limited to Python and R, runs without a shell, and has a timeout.
- Python and R execution is a convenience feature, not a sandbox. Run only code you trust.
- Generated chat, context, build, and dependency directories are excluded from workspace discovery.
- The Electron renderer is sandboxed, has no Node integration, and receives only a narrow native folder-picker bridge.

See [docs/FORMAT_SUPPORT.md](docs/FORMAT_SUPPORT.md) for the supported research formats, extraction behavior, and limits.

See [docs/REVIEW_MEMOS.md](docs/REVIEW_MEMOS.md) for saved-review storage and source-link behavior.

See [docs/CITATION_CORPUS.md](docs/CITATION_CORPUS.md) for source retrieval, manual imports, evidence packets, and corpus file formats.

See [docs/SUBMISSION_DESK.md](docs/SUBMISSION_DESK.md) for profiles, preflight checks, package contents, and automation boundaries.

See [docs/DESKTOP.md](docs/DESKTOP.md) for the Electron runtime and installer workflow.

See [SECURITY.md](SECURITY.md) for reporting and boundary details.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

`npm run check` runs strict TypeScript validation, the complete test suite, the reusable library build, and a production Next.js build. GitHub Actions runs the same validation for every pull request.

## Roadmap

- Doris feature-convergence work is tracked in [docs/DORIS_CONVERGENCE_ROADMAP.md](docs/DORIS_CONVERGENCE_ROADMAP.md).
- Richer bibliography workflows
- Signed installers and automatic desktop updates
- Commercial validation and product naming

This project is not affiliated with GNU Octave. The name comes from its origin as a research workspace within Doris.

## License

MIT
