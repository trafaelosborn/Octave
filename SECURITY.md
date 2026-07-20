# Security

Octave operates on local research files, so file boundaries and credentials are part of its core security model.

## Workspace boundary

Document paths must be relative to a selected workspace. Octave rejects absolute paths, unsupported extensions, null bytes, and directory traversal. Existing source and PDF artifact paths are resolved through the operating system before they are read or compiled, which prevents a symbolic link inside the workspace from silently targeting a file outside it.

Binary research formats are extracted into read-only previews. Extraction enforces source-size, decompression-size, archive-entry, timeout, and output-character limits. Octave does not enable OCR implicitly and does not write extracted text back over PDF, Office, OpenDocument, RTF, or image files.

The development and production server scripts bind to `127.0.0.1` by default. Octave's API is designed for a single-user local workstation and does not implement network authentication. Do not expose it on a public or untrusted network.

The Electron build selects an ephemeral loopback port, loads only that origin in its application window, blocks cross-origin navigation, and permits only HTTPS links to open externally. Its renderer is sandboxed with Node integration disabled. A context-isolated preload exposes narrow workspace-folder and provider-settings operations; general privileged Electron APIs are not passed through to application code. Each privileged request validates that it came from Octave's private application origin.

Python and R execution is not a sandbox. Octave validates the selected script path, invokes a fixed interpreter without a shell, bounds captured output, and applies a timeout, but the script still runs with the permissions of the Octave process. Run only code you trust.

The `.octave/` directory inside a workspace contains local chat history. It should not be committed with research material unless that is intentional.

## Submission packaging

Submission manifests and generated packages stay under `.octave/`. Manuscript, source-dependency, supplement, package, and download paths are normalized and confined to the selected workspace after symbolic-link resolution. Packaging accepts an explicit extension allowlist and enforces file-count and byte limits before creating ZIP archives.

Preflight scans bounded text inputs for common credential and private-key patterns, but it is a guardrail rather than a complete secret detector. Inspect every generated bundle before uploading it. Octave records human declarations for authorship, conflicts, funding, ethics, and licensing; it does not infer them or perform the final submission action.

## Citation retrieval

Citation retrieval runs only after the user selects **Fetch sources**. Remote downloads must use HTTPS, cannot contain URL credentials, and are rejected when DNS resolves to a local, private, or non-routable address. Every redirect is checked again. Metadata responses, source downloads, redirect counts, request duration, file signatures, and extracted text are bounded.

Octave queries scholarly metadata and legitimate open-access locations; it does not attempt to bypass authentication, paywalls, or publisher access controls. Manual sources are accepted only from the generated citation directory and are subject to the same type and size checks. Acquired files and their recorded URLs should still be treated as untrusted research material.

## Provider privacy

Ollama requests remain on the configured Ollama host. Anthropic, OpenAI, and xAI requests send the selected document context and conversation to the chosen provider. A citation-aware paper review can include bounded passages from the local citation corpus. Octave never sends documents to a model provider until a chat request is made with that provider.

Desktop API keys are encrypted through Electron `safeStorage`, bound to the operating-system user account, and persisted only as ciphertext in Electron's per-user application-data directory. Decrypted keys are injected into the private loopback server process and are never returned to the renderer. Browser and CLI users should store keys in environment variables. Never commit `.env` files.

## Reporting a vulnerability

Please report security problems privately through GitHub's security advisory feature rather than opening a public issue.
