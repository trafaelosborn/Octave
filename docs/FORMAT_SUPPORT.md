# Research format support

Octave uses one bounded extraction pipeline for document previews, pinned context, workspace search, chat context, and future per-message attachments.

## Native text formats

These files are decoded as UTF-8 and remain editable:

- LaTeX and bibliography: `.tex`, `.bib`, `.sty`, `.cls`
- Prose and data: `.md`, `.txt`, `.csv`, `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.xml`, `.html`, `.htm`
- Source: `.py`, `.r`, `.js`, `.jsx`, `.ts`, `.tsx`

## Extracted read-only formats

These files are parsed into a read-only text preview. Octave never writes the extracted text back over the source file:

- PDF: `.pdf`
- Microsoft Office: `.docx`, `.xlsx`, `.pptx`
- OpenDocument: `.odt`, `.ods`, `.odp`
- Rich Text Format: `.rtf`

PDF extraction reads selectable text. Scanned or image-only PDFs produce an explicit OCR warning rather than silently returning an empty document. OCR is not enabled in the initial local extraction layer.

## Images

`.png`, `.jpg`, `.jpeg`, `.webp`, and `.gif` files are discoverable. Text-only providers receive file metadata and an explicit warning that visual content requires a vision-capable provider. A later attachment/provider change will transmit image content only to providers that declare vision support.

## Safety limits

- Source files are limited to 25 MB per extraction.
- Archive-based Office/OpenDocument files are limited to 64 MB uncompressed and 5,000 archive entries.
- Parsing times out after 30 seconds.
- Extracted text is bounded by the caller's context-character budget.
- Paths retain Octave's resolved workspace-boundary checks.

Unsupported, oversized, unreadable, encrypted, or empty files fail visibly or produce an extraction warning. They are never silently omitted from context.
