# Desktop application

Octave includes a Windows-first Electron shell that packages the existing Next.js workstation without duplicating its research logic or API surface.

## Architecture

Development and desktop releases use the same React interface and Node-backed routes:

```text
Electron main process
  ├─ starts the local Next.js server on 127.0.0.1 with an ephemeral port
  ├─ opens a sandboxed BrowserWindow on that exact origin
  ├─ owns native folder selection and encrypted provider settings
  └─ stops the server when Octave quits

Electron preload
  └─ exposes a narrow, context-isolated desktop bridge

Next.js standalone runtime
  └─ serves the existing UI and workspace-bound API routes
```

The renderer has no Node integration. Cross-origin navigation is blocked, new windows are denied, and only HTTPS links can be handed to the operating system. Native folder selection validates the requesting frame against the private application origin.

The Electron package is separate from the root npm package, so `@trafaelosborn/octave` continues to export the reusable library from `dist/`.

## Development

Install dependencies and launch Electron with a hot-reloading Next.js server:

```bash
npm install
npm run desktop:dev
```

The ordinary browser workflow remains available through `npm run dev`.

## Provider settings

On first run, the desktop app asks for a default provider and model. OpenAI, xAI, and Anthropic keys are encrypted with Electron `safeStorage` and stored as ciphertext in `provider-settings.json` beneath Electron's per-user application-data directory. The renderer receives only `saved`, `environment`, or `none` status for each credential; saved secret values are never read back into the interface.

Ollama's server URL and model default are not secrets and live in the same settings document. Saving settings restarts Octave's private local server so the new configuration takes effect. Existing environment variables remain fallback configuration when no desktop key has been saved.

## Packaging

Create the production Next.js standalone runtime and an unpacked Electron application:

```bash
npm run desktop:package
```

Create Windows Squirrel and ZIP distributables:

```bash
npm run desktop:make
```

Generated application files and installers are written under `desktop/app/out/`; the copied Next.js runtime lives temporarily under `desktop/app/runtime/`. Both directories are excluded from version control.

The production shell stores its workspace registry beneath Electron's per-user application-data directory. Chats, review memos, citation corpora, and research files remain in their existing workspace-local locations.

## Current release limitations

- Installer artifacts are unsigned and intended for developer testing. Public releases need Windows signing and macOS signing/notarization.
- Automatic updates and release publishing are not configured.
- The current makers target Windows. macOS and Linux packaging require platform-specific makers, CI runners, and testing.
- Electron uses Chromium internally, so the desktop build favors compatibility with Octave's Node architecture over minimum download size.
