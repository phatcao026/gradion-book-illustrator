import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the development placeholder', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Book Illustration Studio' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Frontend ready');
  });
});
