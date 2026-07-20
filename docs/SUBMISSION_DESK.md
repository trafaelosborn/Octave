# Submission Desk

The Submission Desk turns a working research folder into a reviewable upload set. It prepares files and metadata locally; it does not currently sign in to a journal portal or transmit a submission.

## Workflow

1. Open a workspace and choose **Submit**.
2. Select the manuscript and target profile.
3. Review the extracted title and abstract, enter portal metadata and authors in final order, and select any supplementary uploads.
4. Confirm the human declarations and run preflight.
5. Resolve blocking issues, rebuild the manuscript if necessary, then choose **Build package**.
6. Inspect and download the generated bundle before uploading it to the target service.

The editable manifest is stored at `.octave/submission.json`. Generated package directories are stored at `.octave/submissions/<package-id>/`; the source workspace is not modified when a package is built.

## Profiles

- **Journal or general submission** checks required metadata, source completeness, PDF freshness and page limits, citation keys, draft markers, likely secrets, supplements, and human declarations.
- **Anonymous conference** adds checks for identifying TeX commands, non-anonymous author fields, and PDF author metadata.
- **arXiv source package** requires a TeX manuscript and includes its discovered local dependency tree.

Profiles are guardrails, not promises of compliance with a venue's current instructions. The venue name, article type, and optional page limit are recorded in the manifest, but journal-specific forms and declarations must still be checked at submission time.

## Preflight behavior

For a TeX manuscript, Octave follows local `input`, `include`, `subfile`, graphics, bibliography, class, and package references. It includes a matching `.bbl` when present. The source scan also reports missing packaged citation keys, unresolved-reference messages in the latest LaTeX log, overfull boxes, title mismatch, and common draft markers.

Preflight issues have three levels:

- **Blocking** issues prevent package creation, such as a missing PDF or source dependency, stale compiled PDF, page-limit failure, likely secret, or anonymity leak.
- **Human confirmation** issues represent declarations that software cannot truthfully make for an author.
- **Warnings** do not block packaging but should be reviewed.

A package can be built once blocking issues are cleared. It is marked ready only after the human confirmations are also recorded.

## Package contents

Depending on the manuscript and selected supplements, a package contains:

- `manuscript.pdf`, normalized to a stable upload name;
- `source.zip`, containing discovered TeX source dependencies;
- supplementary files;
- `submission.json`, the structured portal metadata;
- `preflight.json`, the exact report used to permit packaging;
- `checksums.json`, with the sizes and SHA-256 hashes of the upload artifacts packaged alongside it;
- `package-record.json`, with the package inventory and bundle hash; and
- `submission-bundle.zip`, containing the upload set and records.

Source collection is limited to 500 files and 100 MB. The final PDF is limited to 100 MB, and selected supplements are limited to 250 MB total. Paths must remain inside the workspace after symbolic-link resolution. ZIP entries use stable timestamps so identical inputs produce stable source archives.

## Automation boundary

Octave never invents declarations, bypasses access controls, or silently submits a paper. Portal automation should preserve a visible preview of every field and upload, stop for MFA and CAPTCHA, create a draft where the service permits it, and require an immediate user confirmation before the final external action.

The planned first connector is OpenReview API2. ScholarOne and Editorial Manager generally require venue-specific portal interaction, so any future support for them should be a user-visible assistant rather than hidden credential replay.
