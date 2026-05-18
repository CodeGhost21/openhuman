import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IntelligenceDreamsTab from './IntelligenceDreamsTab';

describe('<IntelligenceDreamsTab />', () => {
  it('renders the dreams title, description and coming-soon line', () => {
    render(<IntelligenceDreamsTab />);
    // useT falls back to the key string when no provider is mounted.
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    // Body and footer copy both render as <p>.
    expect(document.querySelectorAll('p')).toHaveLength(2);
  });

  it('renders a decorative svg icon', () => {
    const { container } = render(<IntelligenceDreamsTab />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
