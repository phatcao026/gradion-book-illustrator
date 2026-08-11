export const BOOK_CONTEXT_PROMPT =
  "Here is a book to illustrate. Do not produce an illustration yet; instructions will follow in later interactions.";

export const GENERATED_STYLE_PROMPT =
  'Define an art style that fits this story with a distinctive twist. Return only the reusable art-style prompt for future illustration prompts.';

export function userStylePrompt(style: string): string {
  return `The art style will be: "${style}". Keep it in mind when generating future prompts. Do not generate an illustration yet; instructions will follow.`;
}

export const CHARACTERS_PROMPT = `
Describe the main adult characters only. Return at most two characters.
For each character, provide their name and a detailed image-generation prompt grounded in the descriptions from the book.
Each prompt should be at least 50 words and must describe one adult character consistently enough for a later portrait.
Do not include children, chapter descriptions, or image data.
`.trim();

export function chaptersPrompt(
  characters: Array<{ name: string; prompt: string }>,
): string {
  const persistedCharacters =
    characters.length === 0
      ? 'No adult characters were identified for this book.'
      : characters
          .map(
            (character) =>
              `- ${character.name}: ${character.prompt}`,
          )
          .join('\n');

  return `
Create exactly one chapter illustration prompt for the book.
Choose a representative scene that works as one full-bleed image, not a multi-panel or tiled page.
Return a concise scene name and a highly descriptive image-generation prompt grounded in the book.
Name every persisted adult character who appears and reuse their established visual description accurately.
Persisted adult characters:
${persistedCharacters}
Do not return image data or more than one chapter.
  `.trim();
}

export function portraitPrompt(input: {
  characterName: string;
  characterPrompt: string;
  style: string;
  hasReferencePortraits: boolean;
}): string {
  const referenceInstruction = input.hasReferencePortraits
    ? 'Use the supplied completed portraits as visual references for a consistent cast and art direction.'
    : 'Establish the visual identity for this cast and keep it reusable in later chained images.';

  return `
Create one 9:16 portrait illustration of the adult character ${input.characterName}.
Character description: ${input.characterPrompt}
Art direction: ${input.style}
${referenceInstruction}
Compose one centered adult character in a clear portrait pose with an uncluttered supporting background.
Produce a single full-bleed family-friendly illustration with uplifting colors, no panels, borders, title, caption, typography, or written text.
  `.trim();
}

export function chapterIllustrationPrompt(input: {
  chapterName: string;
  chapterPrompt: string;
  style: string;
  hasReferencePortraits: boolean;
}): string {
  const referenceInstruction = input.hasReferencePortraits
    ? 'Use the supplied completed portraits as exact visual references for every matching adult character.'
    : 'Reuse the adult character identities established earlier in this image conversation when available.';

  return `
Transition from character portraits to one 16:9 chapter scene illustration.
Scene name: ${input.chapterName}
Scene description: ${input.chapterPrompt}
Art direction: ${input.style}
${referenceInstruction}
Characters may change pose, expression, scale, and position to fit the scene, but their identity, clothing, and defining features must remain consistent.
Produce one cinematic, full-bleed, family-friendly illustration with uplifting colors, no panels, borders, cover layout, title, caption, typography, or written text.
  `.trim();
}
