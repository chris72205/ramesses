import { describe, expect, it } from 'vitest';
import { parseDeadline, trackerKindFor } from './tracker-kind';

describe('trackerKindFor', () => {
  it('recognizes the universal tracker leaderboards', () => {
    expect(trackerKindFor('https://tracker.archiveteam.org/blogger/')).toBe('universal');
    expect(trackerKindFor('https://tracker.archiveteam.org/telegram')).toBe('universal');
  });

  it('recognizes the terroroftinytown tracker by its port', () => {
    expect(trackerKindFor('https://tracker.archiveteam.org:1338/')).toBe('terroroftinytown');
  });

  it('is unknown for missing, foreign, malformed, or nested URLs', () => {
    expect(trackerKindFor(null)).toBe('unknown');
    expect(trackerKindFor('')).toBe('unknown');
    expect(trackerKindFor('not a url')).toBe('unknown');
    expect(trackerKindFor('https://example.org/blogger/')).toBe('unknown');
    expect(trackerKindFor('https://tracker.archiveteam.org/a/b/')).toBe('unknown');
  });
});

describe('parseDeadline', () => {
  it('parses the tracker format and drops garbage', () => {
    expect(parseDeadline('2026-12-31T23:59:00Z')?.toISOString()).toBe('2026-12-31T23:59:00.000Z');
    expect(parseDeadline(null)).toBeNull();
    expect(parseDeadline('soon')).toBeNull();
  });
});
