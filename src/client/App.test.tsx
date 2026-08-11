import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend flows', () => {
  it('shows the identity screen and validates its fields', async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
        401,
      ),
    );

    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'Start or resume your story' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name must have at least 2 characters.',
    );
  });

  it('renders the project empty state for a signed-in user', async () => {
    stubFetch((input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({ user: sessionUser });
      }
      if (url === '/api/projects') {
        return jsonResponse({ projects: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderApp('/projects');

    expect(
      await screen.findByRole('heading', { name: 'No projects yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('validates the new-project title and source before sending a request', async () => {
    stubFetch((input) => {
      if (String(input) === '/api/session') {
        return jsonResponse({ user: sessionUser });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    renderApp('/projects/new');
    const submit = await screen.findByRole('button', { name: 'Create project' });

    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project title is required.',
    );

    fireEvent.change(screen.getByLabelText('Project title'), {
      target: { value: 'River Story' },
    });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Provide exactly one book source',
    );
  });

  it('renders the complete stored book text on project detail', async () => {
    stubFetch((input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({ user: sessionUser });
      }
      if (url === '/api/projects/project-1') {
        return jsonResponse({
          project: {
            id: 'project-1',
            title: 'River Story',
            createdAt: '2026-08-11T00:00:00.000Z',
            status: 'DRAFT',
            pipeline: idlePipeline,
            bookText: 'The complete book remains readable here.',
            styleInput: '',
            style: null,
            characters: [],
            chapters: [],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderApp('/projects/project-1');

    expect(
      await screen.findByRole('heading', { name: 'River Story' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The complete book remains readable here.'),
    ).toBeInTheDocument();
  });

  it('renders persisted Style and Character outputs on project detail', async () => {
    stubFetch((input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({ user: sessionUser });
      }
      if (url === '/api/projects/project-2') {
        return jsonResponse({
          project: {
            id: 'project-2',
            title: 'Forest Story',
            createdAt: '2026-08-11T00:00:00.000Z',
            status: 'IN_PROGRESS',
            pipeline: { ...idlePipeline, completedStep: 2, nextStep: 3 },
            bookText: 'A saved forest story.',
            styleInput: '',
            style: { source: 'GENERATED', text: 'Layered watercolor washes.' },
            characters: [
              {
                id: 'character-1',
                name: 'Mara',
                prompt: 'A consistent adult portrait prompt with clothing and lighting details.',
                portrait: null,
              },
            ],
            chapters: [],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderApp('/projects/project-2');

    expect(await screen.findByText('Layered watercolor washes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mara' })).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('renders completed and failed portrait item states', async () => {
    stubFetch((input) => {
      const url = String(input);
      if (url === '/api/session') return jsonResponse({ user: sessionUser });
      if (url === '/api/projects/project-3') {
        return jsonResponse({
          project: {
            id: 'project-3',
            title: 'Portrait Story',
            createdAt: '2026-08-11T00:00:00.000Z',
            status: 'IN_PROGRESS',
            pipeline: {
              ...idlePipeline,
              completedStep: 2,
              activeStep: 3,
              nextStep: 3,
              runState: 'FAILED',
              attemptId: 'portrait-attempt',
              error: { code: 'GEMINI_REQUEST_FAILED', message: 'Portrait generation stopped.' },
            },
            bookText: 'A saved portrait story.',
            styleInput: '',
            style: { source: 'GENERATED', text: 'Layered watercolor.' },
            characters: [
              {
                id: 'character-1',
                name: 'Mara',
                prompt: 'An adult river guide.',
                portrait: {
                  status: 'COMPLETED',
                  imageUrl: '/api/projects/project-3/characters/character-1/portrait',
                  mimeType: 'image/png',
                  error: null,
                },
              },
              {
                id: 'character-2',
                name: 'Theo',
                prompt: 'An adult cartographer.',
                portrait: {
                  status: 'FAILED',
                  imageUrl: null,
                  mimeType: null,
                  error: { code: 'GEMINI_REQUEST_FAILED', message: 'Image request failed.' },
                },
              },
            ],
            chapters: [],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderApp('/projects/project-3');

    expect(await screen.findByAltText('Portrait of Mara')).toHaveAttribute(
      'src',
      '/api/projects/project-3/characters/character-1/portrait',
    );
    expect(screen.getByText('Portrait failed')).toBeInTheDocument();
    expect(screen.getByText('Image request failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Portraits' })).toBeEnabled();
  });

  it('renders a failed chapter illustration and exposes only its explicit retry', async () => {
    stubFetch((input) => {
      const url = String(input);
      if (url === '/api/session') return jsonResponse({ user: sessionUser });
      if (url === '/api/projects/project-4') {
        return jsonResponse({
          project: {
            id: 'project-4',
            title: 'Chapter Story',
            createdAt: '2026-08-11T00:00:00.000Z',
            status: 'IN_PROGRESS',
            pipeline: {
              ...idlePipeline,
              completedStep: 4,
              activeStep: 5,
              nextStep: 5,
              runState: 'FAILED',
              attemptId: 'illustration-attempt',
              error: {
                code: 'GEMINI_REQUEST_FAILED',
                message: 'Chapter illustration stopped.',
              },
            },
            bookText: 'A saved chapter story.',
            styleInput: '',
            style: { source: 'GENERATED', text: 'Layered watercolor.' },
            characters: [],
            chapters: [
              {
                id: 'chapter-1',
                name: 'River Reunion',
                prompt: 'A cinematic riverbank reunion at sunset.',
                illustration: {
                  status: 'FAILED',
                  imageUrl: null,
                  mimeType: null,
                  error: {
                    code: 'GEMINI_REQUEST_FAILED',
                    message: 'Image request failed.',
                  },
                },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderApp('/projects/project-4');

    expect(await screen.findByRole('heading', { name: 'River Reunion' })).toBeInTheDocument();
    expect(screen.getByText('Illustration failed')).toBeInTheDocument();
    expect(screen.getByText('Image request failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Illustrations' })).toBeEnabled();
  });

  it('renders the completed final illustration and Done project state', async () => {
    stubFetch((input) => {
      const url = String(input);
      if (url === '/api/session') return jsonResponse({ user: sessionUser });
      if (url === '/api/projects/project-5') {
        return jsonResponse({
          project: {
            id: 'project-5',
            title: 'Finished Story',
            createdAt: '2026-08-11T00:00:00.000Z',
            status: 'DONE',
            pipeline: {
              ...idlePipeline,
              completedStep: 5,
              nextStep: null,
            },
            bookText: 'The complete book remains available.',
            styleInput: '',
            style: { source: 'GENERATED', text: 'Layered watercolor.' },
            characters: [],
            chapters: [
              {
                id: 'chapter-1',
                name: 'River Reunion',
                prompt: 'A cinematic riverbank reunion at sunset.',
                illustration: {
                  status: 'COMPLETED',
                  imageUrl:
                    '/api/projects/project-5/chapters/chapter-1/illustration',
                  mimeType: 'image/png',
                  error: null,
                },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderApp('/projects/project-5');

    expect(await screen.findByText('Done')).toBeInTheDocument();
    expect(screen.getByAltText('Illustration for River Reunion')).toHaveAttribute(
      'src',
      '/api/projects/project-5/chapters/chapter-1/illustration',
    );
    expect(screen.getByText('The complete book remains available.')).toBeInTheDocument();
  });
});

const sessionUser = {
  id: 'user-1',
  name: 'Mira Hassan',
  email: 'mira@example.com',
};

const idlePipeline = {
  completedStep: 0,
  activeStep: null,
  nextStep: 1,
  runState: 'IDLE',
  attemptId: null,
  startedAt: null,
  error: null,
  isStale: false,
};

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

function stubFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Response,
) {
  vi.stubGlobal('fetch', vi.fn(implementation));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
