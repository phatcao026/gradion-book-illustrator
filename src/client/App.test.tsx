import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Milestone 1 frontend', () => {
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
