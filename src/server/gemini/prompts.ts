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
