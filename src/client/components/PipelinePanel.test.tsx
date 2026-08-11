import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PipelineState } from '../../shared/contracts';
import { PipelinePanel } from './PipelinePanel';

describe('PipelinePanel persisted states', () => {
  it('collects optional style direction and starts Style only on user action', () => {
    const onStart = vi.fn();
    const onStyleInputChange = vi.fn();
    render(
      <PipelinePanel
        onStart={onStart}
        onStyleInputChange={onStyleInputChange}
        pipeline={state({})}
        styleInput="Paper collage"
      />,
    );

    expect(screen.getByLabelText('Optional art style')).toHaveValue('Paper collage');
    fireEvent.change(screen.getByLabelText('Optional art style'), {
      target: { value: 'Watercolor' },
    });
    expect(onStyleInputChange).toHaveBeenCalledWith('Watercolor');

    fireEvent.click(screen.getByRole('button', { name: 'Generate Style' }));
    expect(onStart).toHaveBeenCalledWith(1);
  });

  it('renders a named running state and disables duplicate action', () => {
    render(
      <PipelinePanel
        pipeline={state({
          activeStep: 2,
          nextStep: 2,
          runState: 'RUNNING',
          attemptId: 'attempt-running',
          startedAt: '2026-08-11T03:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText('Characters is running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Characters in progress/ })).toBeDisabled();
    expect(screen.getByText('Characters is running').parentElement).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText('Characters is running').parentElement).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByText('Characters').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('renders a failed step without carrying the running presentation', () => {
    render(
      <PipelinePanel
        pipeline={state({
          completedStep: 1,
          activeStep: 2,
          nextStep: 2,
          runState: 'FAILED',
          attemptId: 'attempt-failed',
          startedAt: '2026-08-11T03:00:00.000Z',
          error: { code: 'PROVIDER_ERROR', message: 'Character generation failed.' },
        })}
      />,
    );

    expect(screen.getByText('Characters failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Character generation failed.');
    expect(screen.getByRole('button', { name: /Retry Characters/ })).toBeDisabled();
  });

  it('enables an explicit Characters retry without showing the Style editor', () => {
    const onStart = vi.fn();
    render(
      <PipelinePanel
        onStart={onStart}
        pipeline={state({
          completedStep: 1,
          activeStep: 2,
          nextStep: 2,
          runState: 'FAILED',
          attemptId: 'attempt-failed',
          error: { code: 'PROVIDER_ERROR', message: 'Try again.' },
        })}
      />,
    );

    expect(screen.queryByLabelText('Optional art style')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Characters' }));
    expect(onStart).toHaveBeenCalledWith(2);
  });

  it('starts Portraits, Chapters, and Illustrations only on explicit actions', () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <PipelinePanel
        onStart={onStart}
        pipeline={state({ completedStep: 2, nextStep: 3 })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate Portraits' }));
    expect(onStart).toHaveBeenCalledWith(3);

    rerender(
      <PipelinePanel
        onStart={onStart}
        pipeline={state({ completedStep: 3, nextStep: 4 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate Chapters' }));
    expect(onStart).toHaveBeenCalledWith(4);

    rerender(
      <PipelinePanel
        onStart={onStart}
        pipeline={state({ completedStep: 4, nextStep: 5 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate Illustrations' }));
    expect(onStart).toHaveBeenCalledWith(5);
  });

  it('offers a user-triggered recovery only for a stale running attempt', () => {
    const onRecover = vi.fn();
    render(
      <PipelinePanel
        onRecover={onRecover}
        pipeline={state({
          completedStep: 2,
          activeStep: 3,
          nextStep: 3,
          runState: 'RUNNING',
          attemptId: 'attempt-stale',
          startedAt: '2026-08-11T02:00:00.000Z',
          isStale: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recover interrupted attempt' }));
    expect(onRecover).toHaveBeenCalledOnce();
    expect(screen.getByText('Portraits appears interrupted')).toBeInTheDocument();
  });

  it('renders the persisted interrupted state and retained error', () => {
    render(
      <PipelinePanel
        pipeline={state({
          completedStep: 2,
          activeStep: 3,
          nextStep: 3,
          runState: 'INTERRUPTED',
          attemptId: 'attempt-interrupted',
          startedAt: '2026-08-11T02:00:00.000Z',
          error: {
            code: 'STALE_ATTEMPT',
            message: 'The previous attempt was interrupted and can be retried.',
          },
        })}
      />,
    );

    expect(screen.getByText('Portraits was interrupted')).toBeInTheDocument();
    expect(screen.getByText(/previous attempt was interrupted/)).toBeInTheDocument();
  });
});

function state(overrides: Partial<PipelineState>): PipelineState {
  return {
    completedStep: 0,
    activeStep: null,
    nextStep: 1,
    runState: 'IDLE',
    attemptId: null,
    startedAt: null,
    error: null,
    isStale: false,
    ...overrides,
  };
}
