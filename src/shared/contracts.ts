import { z } from 'zod';

export const MAX_BOOK_BYTES = 2 * 1024 * 1024;
export const PIPELINE_STEPS = [
  'STYLE',
  'CHARACTERS',
  'PORTRAITS',
  'CHAPTERS',
  'ILLUSTRATIONS',
] as const;

export type PipelineStepNumber = 1 | 2 | 3 | 4 | 5;
export type PipelineRunState = 'IDLE' | 'RUNNING' | 'FAILED' | 'INTERRUPTED';
export type ProjectStatus = 'DRAFT' | 'IN_PROGRESS' | 'DONE';
export type StyleSource = 'USER' | 'GENERATED';

export interface PipelineError {
  code: string;
  message: string;
}

export interface PipelineState {
  completedStep: number;
  activeStep: PipelineStepNumber | null;
  nextStep: PipelineStepNumber | null;
  runState: PipelineRunState;
  attemptId: string | null;
  startedAt: string | null;
  error: PipelineError | null;
  isStale: boolean;
}

export interface StyleResult {
  source: StyleSource;
  text: string;
}

export interface CharacterResult {
  id: string;
  name: string;
  prompt: string;
}

export const styleInputSchema = z
  .string()
  .trim()
  .max(2_000, 'Style must be 2,000 characters or fewer.');

export const pipelineStartInputSchema = z.object({
  style: styleInputSchema.optional().default(''),
});

export const identityInputSchema = z.object({
  name: z.string().trim().min(2, 'Name must have at least 2 characters.').max(100),
  email: z
    .string()
    .trim()
    .max(254)
    .email('Enter a valid email address.')
    .transform((email) => email.toLowerCase()),
});

export const projectTitleSchema = z
  .string()
  .trim()
  .min(1, 'Project title is required.')
  .max(160, 'Project title must be 160 characters or fewer.');

export type IdentityInput = z.infer<typeof identityInputSchema>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  status: ProjectStatus;
  pipeline: PipelineState;
}

export interface ProjectDetail extends ProjectSummary {
  bookText: string;
  style: StyleResult | null;
  styleInput: string;
  characters: CharacterResult[];
}
