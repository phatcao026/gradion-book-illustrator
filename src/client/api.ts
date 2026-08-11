import type {
  IdentityInput,
  ProjectDetail,
  ProjectSummary,
  SessionUser,
} from '../shared/contracts';

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function getSession(): Promise<SessionUser> {
  const response = await apiFetch('/api/session');
  const body = (await response.json()) as { user: SessionUser };
  return body.user;
}

export async function signIn(input: IdentityInput): Promise<SessionUser> {
  const response = await apiFetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { user: SessionUser };
  return body.user;
}

export async function signOut(): Promise<void> {
  await apiFetch('/api/session', { method: 'DELETE' });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await apiFetch('/api/projects');
  const body = (await response.json()) as { projects: ProjectSummary[] };
  return body.projects;
}

export async function createProject(
  title: string,
  bookText: string,
  bookFile: File | null,
): Promise<ProjectSummary> {
  const form = new FormData();
  form.set('title', title);

  if (bookFile) {
    form.set('bookFile', bookFile);
  } else {
    form.set('bookText', bookText);
  }

  const response = await apiFetch('/api/projects', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json()) as { project: ProjectSummary };
  return body.project;
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`);
  const body = (await response.json()) as { project: ProjectDetail };
  return body.project;
}

async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    let body: ErrorResponse = {};

    try {
      body = (await response.json()) as ErrorResponse;
    } catch {
      // The fallback below is used for non-JSON proxy or network responses.
    }

    throw new ApiError(
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? 'The request could not be completed.',
    );
  }

  return response;
}
