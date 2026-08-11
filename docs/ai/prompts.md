# Gemini prompts used by the application

This is the review artifact for the M3 prompts. The executable source of truth is `src/server/gemini/prompts.ts`; changes to these prompts should update both places in the same commit.

## Book context

Sent with the uploaded book document when creating the first stored interaction:

```text
Here is a book to illustrate. Do not produce an illustration yet; instructions will follow in later interactions.
```

## Generated Style

Sent when the optional style field is blank:

```text
Define an art style that fits this story with a distinctive twist. Return only the reusable art-style prompt for future illustration prompts.
```

## User-provided Style

Sent when the user supplies a style. `{style}` is replaced by the server-validated value:

```text
The art style will be: "{style}". Keep it in mind when generating future prompts. Do not generate an illustration yet; instructions will follow.
```

The persisted Style result remains exactly the user's normalized input. The interaction's response is not presented as if Gemini authored that input.

## Adult Characters

Sent from the Style interaction:

```text
Describe the main adult characters only. Return at most two characters.
For each character, provide their name and a detailed image-generation prompt grounded in the descriptions from the book.
Each prompt should be at least 50 words and must describe one adult character consistently enough for a later portrait.
Do not include children, chapter descriptions, or image data.
```

The request also uses a JSON response schema for an array of `{ name, prompt }` objects with `maxItems: 2`. The server independently parses strict JSON, permits zero to two entries, rejects duplicate case-insensitive names, and applies length limits before writing any character row.

## Execution settings

- Default text model: `gemini-3.6-flash`, configurable with `GEMINI_TEXT_MODEL`.
- Service tier: `standard` only.
- Interactions are stored and chained using `previous_interaction_id`.
- SDK automatic retries: `0`; every retry must be initiated by the user.
- Image prompts and image-generation mechanics are intentionally outside M3.
