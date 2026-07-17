# Security

Octave operates on local research files, so file boundaries and credentials are part of its core security model.

## Workspace boundary

Document paths must be relative to a selected workspace. Octave rejects absolute paths, unsupported extensions, null bytes, and directory traversal. Existing files are resolved through the operating system before they are read or compiled, which prevents a symbolic link inside the workspace from silently targeting a file outside it.

The `.octave/` directory inside a workspace contains local chat history. It should not be committed with research material unless that is intentional.

## Provider privacy

Ollama requests remain on the configured Ollama host. Anthropic requests send the selected document context and conversation to Anthropic's API. Octave never sends documents to a provider until a chat request is made with that provider.

Store API keys in environment variables. Never commit `.env` files.

## Reporting a vulnerability

Please report security problems privately through GitHub's security advisory feature rather than opening a public issue.
