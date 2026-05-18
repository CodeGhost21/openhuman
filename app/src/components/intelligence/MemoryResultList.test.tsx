import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Chunk } from '../../utils/tauriCommands';
import { MemoryResultList } from './MemoryResultList';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: 'chunk-1',
    source_kind: 'email',
    source_id: 'gmail:alice@example.com|thread-1',
    owner: 'me',
    timestamp_ms: Date.now(),
    token_count: 12,
    lifecycle_status: 'admitted',
    has_embedding: true,
    tags: [],
    content_preview: 'Subject of the message line. More body follows.',
    ...overrides,
  };
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe('<MemoryResultList />', () => {
  it('renders the no-results state when the list is empty', () => {
    render(<MemoryResultList chunks={[]} selectedChunkId={null} onSelectChunk={() => {}} />);
    expect(screen.getByTestId('memory-result-list')).toBeInTheDocument();
    // Default i18n context falls back to the en translation map.
    expect(screen.getByText(/No memories found/i)).toBeInTheDocument();
  });

  it('renders chunks bucketed into the four time-group sections', () => {
    const todayMs = startOfTodayMs();
    const chunks = [
      makeChunk({ id: 'today-1', timestamp_ms: todayMs + 9 * 60 * 60 * 1000 }),
      makeChunk({ id: 'yesterday-1', timestamp_ms: todayMs - 2 * 60 * 60 * 1000 }),
      makeChunk({ id: 'thisweek-1', timestamp_ms: todayMs - 3 * DAY_MS }),
      makeChunk({ id: 'older-1', timestamp_ms: todayMs - 30 * DAY_MS }),
    ];
    render(
      <MemoryResultList chunks={chunks} selectedChunkId={null} onSelectChunk={() => {}} />
    );

    // Section headers are uppercased literal strings, not i18n keys.
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(screen.getByText('YESTERDAY')).toBeInTheDocument();
    expect(screen.getByText('THIS WEEK')).toBeInTheDocument();
    expect(screen.getByText('OLDER')).toBeInTheDocument();

    // One row button per chunk.
    expect(document.querySelectorAll('button[data-chunk-id]').length).toBe(4);
  });

  it('marks the active row via aria-pressed and is-active class', () => {
    const todayMs = startOfTodayMs();
    const chunks = [
      makeChunk({ id: 'a', timestamp_ms: todayMs + 1 }),
      makeChunk({ id: 'b', timestamp_ms: todayMs + 2 }),
    ];
    const { container } = render(
      <MemoryResultList chunks={chunks} selectedChunkId="b" onSelectChunk={() => {}} />
    );
    const active = container.querySelector('button[data-chunk-id="b"]') as HTMLButtonElement;
    expect(active).not.toBeNull();
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.className).toContain('is-active');
  });

  it('fires onSelectChunk when a row is clicked', () => {
    const todayMs = startOfTodayMs();
    const onSelect = vi.fn();
    const chunks = [makeChunk({ id: 'click-me', timestamp_ms: todayMs + 1 })];
    render(<MemoryResultList chunks={chunks} selectedChunkId={null} onSelectChunk={onSelect} />);
    fireEvent.click(screen.getByRole('button', { pressed: false }));
    expect(onSelect).toHaveBeenCalledWith('click-me');
  });

  it('renders a sender label derived from the source_id', () => {
    const chunks = [
      makeChunk({
        id: 'q',
        source_id: 'gmail:alice@example.com|thread-1',
        timestamp_ms: startOfTodayMs() + 1,
      }),
    ];
    render(<MemoryResultList chunks={chunks} selectedChunkId={null} onSelectChunk={() => {}} />);
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
  });

  it('uses the chunk id as the subject when no content preview is provided', () => {
    const chunks = [
      makeChunk({
        id: 'no-preview-id',
        content_preview: '',
        timestamp_ms: startOfTodayMs() + 1,
      }),
    ];
    render(<MemoryResultList chunks={chunks} selectedChunkId={null} onSelectChunk={() => {}} />);
    expect(screen.getByText('no-preview-id')).toBeInTheDocument();
  });
});
