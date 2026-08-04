# Source-grounded research

Octave's research wedge is simple: keep ordinary source files in the project, then ask the model to reason from those files before it reasons from memory.

That is useful outside journal-style citation checking. A historian can drop translations of Arrian, Diodorus, Curtius, Plutarch, excavation notes, and secondary scholarship into a project folder, then ask a question like:

> How high were the walls of Halicarnassus likely to have been?

Octave should help separate three things:

1. What the provided primary sources actually say.
2. What secondary sources or technical notes add.
3. What remains inference, uncertainty, or a missing-source problem.

## Current workflow

1. Open a local research folder.
2. Put source files in the folder or a visible subfolder such as `sources/`.
3. Open the **Sources** rail.
4. Choose **Save inventory** to write `.octave/source-inventory.json`.
5. Correct inferred source types when needed: primary, secondary, archive/data, or unknown.
6. Choose **Create evidence map** to save a paired JSON/Markdown source-passage map under `.octave/evidence-maps/`.
7. Choose **Build source brief** to start a project-scoped chat with the inventory and up to eight source files attached.
8. Ask for exact file paths, page cues, quoted or paraphrased evidence, and a missing-source list.

The built-in **Source brief** prompt asks Octave to:

- use the source inventory as the working evidence shelf;
- list what evidence the project source folder contains;
- answer with exact file paths or page/line cues when available;
- distinguish primary sources, secondary sources, and inference;
- say what the current source folder does not establish;
- suggest specific missing sources to add next.

The inventory scans files under source-like folders including `sources/`, `source/`, `primary/`, `secondary/`, `archive/`, `archives/`, `data/`, and `datasets/`. Manual role corrections are preserved across rescans.

## Evidence maps

Evidence maps are durable review artifacts, not finished arguments. Octave extracts bounded candidate passages from the source inventory and writes:

```text
.octave/evidence-maps/<id>.json
.octave/evidence-maps/<id>.md
```

The JSON keeps:

- the research question or topic;
- the source-inventory snapshot;
- source paths, roles, tags, sizes, and modification times;
- candidate passages with source path, role, locator, and extraction warnings;
- empty review fields for direct support, inference notes, and missing sources.

The Markdown version is for human reading and annotation. The goal is to make source-grounded work reusable: a later draft checker can compare claims against the evidence map instead of asking a model to rediscover the same source shelf from scratch.

## Claim checks

Once evidence maps exist, choose **Check claims** from the top bar or **Check draft claims** in the Sources rail. Octave reads the active draft, extracts substantive paragraphs as candidate claims, and compares them against:

- saved evidence-map passages;
- the latest citation-check report, when formal citation evidence exists.

The result is saved as:

```text
.octave/claim-checks/<id>.json
.octave/claim-checks/<id>.md
```

Findings are grouped as likely supported, weak source match, citation warning, citation error, no candidate evidence, or no evidence available. Like citation checks, claim checks are lexical review queues rather than final entailment judgments.

## Why this matters

Citation auditing catches bibliography-level failures: nonexistent keys, unavailable originals, and claims that do not map cleanly onto retrieved citation text.

Source-grounded research is broader. It turns a local folder into a working evidence shelf for any domain: ancient history, law, economics, engineering notes, interview transcripts, lab reports, policy memos, or archives. The marketing promise is not "the model knows everything"; it is "the model shows its work against the sources you actually possess."

## Boundaries

- A source brief is a research assistant output, not proof that the sources are complete.
- The model may miss relevant passages if the source set is too large or poorly extracted.
- Page and line cues depend on the extraction format available for each file.
- Missing-source suggestions are leads for the researcher, not a claim that the suggested source exists in the project.

## Next improvements

- Add passage-level review actions: "accept as evidence," "reject," and "needs manual lookup."
- Add model-assisted adjudication for borderline claim-check findings while preserving the deterministic report as the audit trail.
