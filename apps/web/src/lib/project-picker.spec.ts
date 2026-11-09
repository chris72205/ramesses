import { describe, expect, it } from 'vitest';
import { summary } from '../test/project-fixtures';
import { pickerRate, sortPickerEntries } from './project-picker';

describe('pickerRate', () => {
  it('leads with the last hour', () => {
    const project = summary({ doneRate: { h1: 100, h6: 200, h24: 300 } });
    expect(pickerRate(project)).toEqual({ value: 100, window: '1 h' });
  });

  it('falls back to the last day when the hourly window has no sample', () => {
    const project = summary({ doneRate: { h1: null, h6: null, h24: 300 } });
    expect(pickerRate(project)).toEqual({ value: 300, window: '24 h' });
  });

  it('keeps zero as a real rate', () => {
    const project = summary({ doneRate: { h1: 0, h6: 200, h24: 300 } });
    expect(pickerRate(project)).toEqual({ value: 0, window: '1 h' });
  });

  it('has no rate without samples or on another tracker', () => {
    expect(pickerRate(summary({ doneRate: { h1: null, h6: null, h24: null } }))).toBeNull();
    expect(pickerRate(summary({ tracker: 'terroroftinytown' }))).toBeNull();
  });
});

describe('sortPickerEntries', () => {
  const entries = [
    { name: 'c', title: 'Charlie' },
    { name: 'a', title: 'Alpha' },
    { name: 'u', title: 'Unknown' },
    { name: 'b', title: 'Bravo' },
    { name: 'n', title: 'Norate' },
  ];
  const summaries = new Map(
    [
      summary({ name: 'a', doneRate: { h1: 10, h6: null, h24: null } }),
      summary({ name: 'b', doneRate: { h1: 50, h6: null, h24: null } }),
      summary({ name: 'c', doneRate: { h1: 10, h6: null, h24: null } }),
      summary({ name: 'n', doneRate: { h1: null, h6: null, h24: null } }),
    ].map((project) => [project.name, project]),
  );
  const names = (mode: 'name' | 'rate') =>
    sortPickerEntries(entries, mode, summaries).map((e) => e.name);

  it('sorts by title', () => {
    expect(names('name')).toEqual(['a', 'b', 'c', 'n', 'u']);
  });

  it('sorts by rate, breaking ties by title and leaving unrated projects last', () => {
    expect(names('rate')).toEqual(['b', 'a', 'c', 'n', 'u']);
  });

  it('does not reorder its input', () => {
    names('rate');
    expect(entries[0]?.name).toBe('c');
  });
});
