# Saved review memos

Octave can preserve any completed assistant response as a durable review memo. Saving a response creates a Markdown artifact under the active workspace's `.octave/reviews/` directory without changing the source document or chat transcript.

Each artifact contains:

- an invisible `octave-review` JSON metadata comment;
- a normal Markdown title and review body;
- the source chat ID, assistant-message timestamp, and message index;
- the document path for document-scoped chats;
- provider and model attribution when the source response recorded it.

The Reviews rail lists artifacts by creation time and opens them in a dedicated Markdown reader. The source-chat action returns to the originating conversation. Saving the same assistant turn again reuses the existing memo instead of creating a duplicate.

Deleting a review removes only its `.md` artifact after confirmation. It does not delete the source chat or modify any research document. Malformed review files are ignored during listing so one damaged artifact cannot hide the rest.

Review titles are limited to 120 characters and memo bodies to 500,000 characters. Existing chat histories without provider or model attribution remain valid and can still be saved as reviews.
