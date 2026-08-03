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
3. Use project scope in Chat, or choose the **Source brief** prompt on an empty chat.
4. Attach the most relevant project files when the source set is large.
5. Ask for exact file paths, page cues, quoted or paraphrased evidence, and a missing-source list.

The built-in **Source brief** prompt asks Octave to:

- list what evidence the project source folder contains;
- answer with exact file paths or page/line cues when available;
- distinguish primary sources, secondary sources, and inference;
- say what the current source folder does not establish;
- suggest specific missing sources to add next.

## Why this matters

Citation auditing catches bibliography-level failures: nonexistent keys, unavailable originals, and claims that do not map cleanly onto retrieved citation text.

Source-grounded research is broader. It turns a local folder into a working evidence shelf for any domain: ancient history, law, economics, engineering notes, interview transcripts, lab reports, policy memos, or archives. The marketing promise is not "the model knows everything"; it is "the model shows its work against the sources you actually possess."

## Boundaries

- A source brief is a research assistant output, not proof that the sources are complete.
- The model may miss relevant passages if the source set is too large or poorly extracted.
- Page and line cues depend on the extraction format available for each file.
- Missing-source suggestions are leads for the researcher, not a claim that the suggested source exists in the project.

## Next improvements

- Add a persistent `sources/` evidence inventory with primary/secondary/manual tags.
- Let source briefs save a machine-readable evidence map under `.octave/`.
- Add passage-level review actions: "accept as evidence," "reject," and "needs manual lookup."
- Connect citation checks and source briefs so paper claims can be compared against both formal citations and informal source folders.
