import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemoryEmptyPlaceholder } from './MemoryEmptyPlaceholder';

describe('<MemoryEmptyPlaceholder />', () => {
  it('renders the empty title and hint copy', () => {
    render(<MemoryEmptyPlaceholder />);
    // Falls back to the i18n key when no provider is present, which is fine
    // for assertion purposes — we just want both lines to render.
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByTestId('memory-empty-placeholder')).toBeInTheDocument();
  });

  it('renders the testid so the workspace can mount it conditionally', () => {
    render(<MemoryEmptyPlaceholder />);
    const root = screen.getByTestId('memory-empty-placeholder');
    expect(root.tagName).toBe('DIV');
    // Title + body paragraph.
    expect(root.querySelector('h2')).not.toBeNull();
    expect(root.querySelector('p')).not.toBeNull();
  });
});
