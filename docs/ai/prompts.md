# Gemini prompts used by the application

This is the review artifact for the prompts used through M4. The executable source of truth is `src/server/gemini/prompts.ts`; changes to these prompts should update both places in the same commit.

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

## Adult Character Portrait

Sent once per persisted adult character. The placeholders are replaced with server-persisted, validated values. The final reference sentence changes depending on whether an expired image chain is being rebuilt from completed local portraits.

```text
Create one 9:16 portrait illustration of the adult character {characterName}.
Character description: {characterPrompt}
Art direction: {style}
{referenceInstruction}
Compose one centered adult character in a clear portrait pose with an uncluttered supporting background.
Produce a single full-bleed family-friendly illustration with uplifting colors, no panels, borders, title, caption, typography, or written text.
```

Normal first portrait instruction:

```text
Establish the visual identity for this cast and keep it reusable in later chained images.
```

Expired-chain rebuild instruction:

```text
Use the supplied completed portraits as visual references for a consistent cast and art direction.
```

## Execution settings

- Default text model: `gemini-3.6-flash`, configurable with `GEMINI_TEXT_MODEL`.
- Default image model: `gemini-3.1-flash-image`, configurable with `GEMINI_IMAGE_MODEL`.
- Service tier: `standard` only.
- Interactions are stored and chained using `previous_interaction_id`.
- Portrait output requests PNG, `9:16`, and `1K`; PNG and JPEG responses are accepted only after byte-level validation.
- Search/grounding tools are not enabled for portrait generation.
- The first actual portrait establishes image context; there is no separate paid seed-image call. Later portraits chain from the preceding portrait interaction.
- When the image interaction expires, completed local portraits are supplied as references and only missing portraits are generated.
- SDK automatic retries: `0`; every retry must be initiated by the user.
