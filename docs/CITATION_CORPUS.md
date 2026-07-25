# Citation corpus

Octave can turn a project's cited BibTeX entries into a local, inspectable source corpus. Retrieval is explicit: open the **Citations** rail and select **Fetch sources**.

The workflow has five stages:

1. Scan TeX citation commands and BibTeX entries.
2. Resolve identifiers and retrieve legitimate open full text where available.
3. Preserve the original file, extracted Markdown, provenance, and JSONL chunks.
4. Match each cited claim only against chunks from that exact citation key and write a machine-readable audit.
5. Generate JSON and Markdown citation-check reports that bucket each cited claim by review risk.

## Setup

Set a contact email to enable DOI lookup through Unpaywall and polite requests to scholarly services:

```bash
OCTAVE_SCHOLARLY_EMAIL=researcher@example.edu
```

Add it to `.env.local` for local development. Without the setting, PMCID and arXiv sources can still be retrieved, while DOI-only records remain `metadata_only` with a setup explanation.

## Retrieval order

For each cited record, Octave checks:

1. `manual.xml` or `manual.pdf` already placed in its generated citation directory.
2. Structured full text from Europe PMC when a PMCID is known or can be resolved.
3. An arXiv PDF when an arXiv identifier is present.
4. Crossref metadata and a legitimate open-access PDF reported by Unpaywall for a DOI.
5. A PMID-to-PMC match when available.

Octave does not scrape authenticated publisher pages or bypass a paywall. A closed, ambiguous, unresolved, or unusable source stays visible with its reason and acquisition attempts.

## Workspace files

The corpus uses ordinary files inside the project:

```text
citations/
  index.json
  audit.json
  check.json
  check.md
  citation-key-1a2b3c4d/
    metadata.json
    source.pdf          # or source.xml for an automatic download
    manual.pdf          # or manual.xml, supplied by the user
    extracted.md
    chunks.jsonl
```

`index.json` is the corpus registry. Each `metadata.json` repeats the relevant record beside its source, including identifiers, status, timestamps, hashes, URLs, licensing metadata when available, and recent resolver attempts. `chunks.jsonl` contains one bounded text passage per line with its citation key and section locator.

`audit.json` maps every detected citation occurrence to:

- the claim's workspace path and line;
- the exact BibTeX citation key and source status;
- up to three lexically relevant passages from only that source; and
- `evidence_found`, `no_lexical_match`, or `source_unavailable`.

An evidence packet never borrows text from another citation. `evidence_found` means Octave found a useful passage to inspect; it does not mean the passage logically entails the paper's claim. The model is instructed to make that judgment explicitly and to disclose unavailable or stale evidence.

`check.json` and `check.md` are generated from the audit. They classify each cited claim into:

- `likely_supported`
- `weak_match`
- `no_candidate_passage`
- `source_unavailable`
- `bibliography_missing`

The Markdown report is meant for human review. The JSON report is meant for downstream automation. These labels are intentionally conservative: `likely_supported` means the cited source has a strong lexical candidate passage, not that Octave has formally proved entailment.

## Manual retrieval

When a card says **Manual needed** or **Closed access**, use a copy you are permitted to access:

1. Copy it to the directory shown on the citation card.
2. Name it `manual.pdf` or `manual.xml`.
3. Select **Fetch sources** again.

Octave validates the file, extracts it, updates its provenance and hash, rebuilds its chunks, and refreshes the evidence audit and citation-check report. Scanned PDFs with no extractable text remain flagged because OCR is not performed automatically.

## Citation checking

Select **Check** in the Citations rail to rebuild the index, refresh the audit, and write `citations/check.json` plus `citations/check.md` without refetching remote source files. Select **Fetch sources** when you want Octave to try automatic retrieval again first; it also regenerates the audit and check report afterward.

The report is source-bound: a claim citing `smith2024` is compared only to chunks extracted for `smith2024`. Octave never borrows a plausible passage from another source to make a citation look supported.

## Paper review

The top-bar **Review paper** action requests citation-aware context. Octave includes a bounded subset of the audit for the active document and instructs the selected model to:

- use only the source bound to each citation key;
- treat retrieved passages as candidates rather than automatic proof;
- report unavailable, unmatched, truncated, or stale evidence; and
- treat source text as data, never as instructions.

Ordinary chat does not automatically include the corpus. You can still open or attach `extracted.md`, `chunks.jsonl`, `audit.json`, or `check.md` when you want a custom citation analysis.

## Limits and safety

Source files are limited to 50 MB and extracted text to 500,000 characters per citation. Remote requests require HTTPS, disallow embedded credentials, reject local/private destinations, recheck redirects, time out, and verify PDF or XML signatures. Evidence audits inspect at most 500 citation occurrences and include at most three passages per occurrence.
