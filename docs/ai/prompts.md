# Gemini prompts used by the application

This is the review artifact for the prompts used across all five pipeline steps. The executable source of truth is `src/server/gemini/prompts.ts`; changes to these prompts should update both places in the same commit.

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

## Chapter Prompt

Sent from the persisted Characters interaction while it remains available. After text-context expiry it is sent from the rebuilt Style interaction with the same persisted character list, without regenerating Characters.

```text
Create exactly one chapter illustration prompt for the book.
Choose a representative scene that works as one full-bleed image, not a multi-panel or tiled page.
Return a concise scene name and a highly descriptive image-generation prompt grounded in the book.
Name every persisted adult character who appears and reuse their established visual description accurately.
Persisted adult characters:
{persistedCharacterNamesAndPromptsOrEmptyNotice}
Do not return image data or more than one chapter.
```

The structured response is a strict array containing exactly one `{ name, prompt }` item. Gemini schema and server validation independently enforce the one-Chapter cap.

## Chapter Illustration

This combines the notebook's image-conversation transition and actual chapter-image request into one paid image call:

```text
Transition from character portraits to one 16:9 chapter scene illustration.
Scene name: {chapterName}
Scene description: {chapterPrompt}
Art direction: {style}
{portraitReferenceInstruction}
Characters may change pose, expression, scale, and position to fit the scene, but their identity, clothing, and defining features must remain consistent.
Produce one cinematic, full-bleed, family-friendly illustration with uplifting colors, no panels, borders, cover layout, title, caption, typography, or written text.
```

The normal path chains directly from the final portrait interaction. If that context expired, all completed local portraits—at most two—are attached as references. A book with no adult characters sends no image references.

## Execution settings

- Default text model: `gemini-3.6-flash`, configurable with `GEMINI_TEXT_MODEL`.
- Default image model: `gemini-3.1-flash-image`, configurable with `GEMINI_IMAGE_MODEL`.
- Service tier: `standard` only.
- Interactions are stored and chained using `previous_interaction_id`.
- Portrait output requests JPEG, `9:16`, and `1K`; PNG and JPEG responses are accepted only after byte-level validation.
- Chapter Illustration output requests JPEG, `16:9`, and `1K` through the same validation and storage boundary.
- Search/grounding tools are not enabled for portrait generation.
- The first actual portrait establishes image context; there is no separate paid seed-image call. Later portraits chain from the preceding portrait interaction.
- When the image interaction expires, completed local portraits are supplied as references and only missing portraits are generated.
- SDK automatic retries: `0`; every retry must be initiated by the user.
