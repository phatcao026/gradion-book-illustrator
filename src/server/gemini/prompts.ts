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
