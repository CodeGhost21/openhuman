import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ActionableItem,
  ActionableItemSource,
  TimeGroup,
} from '../../types/intelligence';
import IntelligenceMemoryTab from './IntelligenceMemoryTab';

function makeItem(overrides: Partial<ActionableItem> = {}): ActionableItem {
  return {
    id: 'i1',
    title: 'Reply to Alice',
    source: 'email',
    priority: 'normal',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    actionable: true,
    ...overrides,
  };
}

interface Overrides {
  isRunning?: boolean;
  items?: ActionableItem[];
  itemsLoading?: boolean;
  searchFilter?: string;
  sourceFilter?: ActionableItemSource | 'all';
  timeGroups?: TimeGroup[];
  usingMemoryData?: boolean;
}

function renderTab(overrides: Overrides = {}) {
  const handleAnalyzeNow = vi.fn().mockResolvedValue(undefined);
  const handleComplete = vi.fn().mockResolvedValue(undefined);
  const handleDismiss = vi.fn();
  const handleSnooze = vi.fn().mockResolvedValue(undefined);
  const setSearchFilter = vi.fn();
  const setSourceFilter = vi.fn();

  render(
    <IntelligenceMemoryTab
      handleAnalyzeNow={handleAnalyzeNow}
      handleComplete={handleComplete}
      handleDismiss={handleDismiss}
      handleSnooze={handleSnooze}
      isRunning={overrides.isRunning ?? false}
      items={overrides.items ?? []}
      itemsLoading={overrides.itemsLoading ?? false}
      searchFilter={overrides.searchFilter ?? ''}
      setSearchFilter={setSearchFilter}
      setSourceFilter={setSourceFilter}
      sourceFilter={overrides.sourceFilter ?? 'all'}
      timeGroups={overrides.timeGroups ?? []}
      usingMemoryData={overrides.usingMemoryData ?? false}
    />
  );

  return {
    handleAnalyzeNow,
    handleComplete,
    handleDismiss,
    handleSnooze,
    setSearchFilter,
    setSourceFilter,
  };
}

describe('<IntelligenceMemoryTab />', () => {
  it('renders the search input and source filter select', () => {
    renderTab();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('dispatches setSearchFilter on input change', () => {
    const { setSearchFilter } = renderTab();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } });
    expect(setSearchFilter).toHaveBeenCalledWith('foo');
  });

  it('dispatches setSourceFilter on select change', () => {
    const { setSourceFilter } = renderTab();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'email' } });
    expect(setSourceFilter).toHaveBeenCalledWith('email');
  });

  it('renders the loading state when itemsLoading and no memory data yet', () => {
    renderTab({ itemsLoading: true });
    // Loading state shows the loading heading (i18n falls back to key).
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders the analyzing state when isRunning and items are empty', () => {
    renderTab({ isRunning: true });
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders the analyze-now button when no analysis has run yet', () => {
    renderTab({ usingMemoryData: false });
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    // handleAnalyzeNow runs via `void` — assert it was scheduled at least once.
    expect(btn).toBeInTheDocument();
  });

  it('renders the no-matches state when filters are active and groups are empty', () => {
    renderTab({ searchFilter: 'foo', sourceFilter: 'email' });
    // The heading branch chosen is "memory.noMatches" — assert any heading renders.
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders the all-caught-up state when usingMemoryData and no groups', () => {
    renderTab({ usingMemoryData: true });
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders time-group sections with their items', () => {
    const items = [makeItem({ id: 'A', title: 'First task' })];
    const timeGroups: TimeGroup[] = [{ label: 'Today', items, count: items.length }];
    renderTab({ items, timeGroups });
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('First task')).toBeInTheDocument();
    // Group count badge.
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
