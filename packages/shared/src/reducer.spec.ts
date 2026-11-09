import { describe, expect, it } from 'vitest';
import burst from '../test/fixtures/connect-burst.json' with { type: 'json' };
import type { WarriorEvent } from './warrior-events.js';
import {
  BANDWIDTH_HISTORY,
  FINISHED_ITEM_TTL_MS,
  LOG_TAIL_CHARS,
  LOG_TAIL_LINES,
  applyEvent,
  createSnapshot,
  pruneFinishedItems,
  resetLiveState,
  stripCarriageReturns,
  tailLines,
} from './reducer.js';

const record = { id: 'w1', name: 'warrior-1', host: '192.0.2.10', port: 8002, enabled: true };
const events = burst as WarriorEvent[];
const T0 = 1_700_000_000_000;

function connected() {
  const snapshot = createSnapshot(record, T0);
  for (const event of events) applyEvent(snapshot, event, T0);
  return snapshot;
}

describe('applyEvent with a recorded connect burst', () => {
  it('captures instance, status, runner, project, items, and bandwidth', () => {
    const s = connected();
    expect(s.instanceId).toBe('8-0.683174');
    expect(s.status).toBe('RUNNING_PROJECT');
    expect(s.runnerStatus).toBe('running');
    expect(s.project?.title).toBe('uploader.jp');
    expect(s.items).toHaveLength(3);
    expect(s.items[0]?.tasks).toHaveLength(10);
    expect(s.items[0]?.status).toBe('running');
    expect(s.bandwidth?.received).toBeGreaterThan(0);
    expect(s.bandwidthHistory).toHaveLength(1);
    expect(s.connection.lastSeenAt).toBe(T0);
  });

  it('resolves the current project from the catalog by name or title', () => {
    const s = connected();
    expect(s.project?.name).toBe('uploaderjp');
    expect(s.project?.logo).toMatch(/^https:\/\//);
    expect(Object.keys(s.catalog)).toContain('telegram');
  });

  it('falls back to the project html for the logo when the catalog has no match', () => {
    const s = createSnapshot(record, T0);
    applyEvent(
      s,
      {
        event_name: 'project.refresh',
        message: {
          status: 'running',
          items: [],
          project: {
            project_id: 1,
            title: 'Mystery',
            utc_deadline: null,
            project_html:
              '<img class="project-logo" src="https://example.org/logo.png"/><a href="https://tracker.example/x">Leaderboard</a>',
          },
        },
      },
      T0,
    );
    expect(s.project).toEqual({
      title: 'Mystery',
      name: null,
      logo: 'https://example.org/logo.png',
      leaderboard: 'https://tracker.example/x',
      deadline: null,
    });
  });
});

describe('item lifecycle', () => {
  const item = {
    id: 'abc-1',
    name: 'Item one',
    number: 1,
    status: 'running' as const,
    tasks: [
      { id: 1, name: 'CheckIP', status: null },
      { id: 2, name: 'Download', status: null },
    ],
    output: '',
    project: 'x',
    start_time: T0 / 1000,
  };

  it('adds, updates, finishes, counts, and prunes items', () => {
    const s = createSnapshot(record, T0);
    expect(
      applyEvent(s, { event_name: 'pipeline.start_item', message: { pipeline_id: 1, item } }, T0),
    ).toBe(true);
    expect(s.items).toHaveLength(1);

    applyEvent(
      s,
      {
        event_name: 'item.task_status',
        message: { item_id: 'abc-1', task_id: 1, new_status: 'running', old_status: null },
      },
      T0,
    );
    expect(s.items[0]?.tasks[0]?.status).toBe('running');

    applyEvent(
      s,
      { event_name: 'item.update_name', message: { item_id: 'abc-1', new_name: 'Item renamed' } },
      T0,
    );
    expect(s.items[0]?.name).toBe('Item renamed');

    applyEvent(
      s,
      { event_name: 'item.output', message: { item_id: 'abc-1', data: 'line one\nline two' } },
      T0,
    );
    expect(s.items[0]?.logTail).toBe('line one\nline two');

    applyEvent(
      s,
      { event_name: 'item.complete', message: { pipeline_id: 1, item_id: 'abc-1' } },
      T0 + 1000,
    );
    expect(s.items[0]?.status).toBe('completed');
    expect(s.items[0]?.finishedAt).toBe(T0 + 1000);
    expect(s.counters.completed).toBe(1);

    expect(pruneFinishedItems(s, T0 + 1000 + FINISHED_ITEM_TTL_MS - 1)).toBe(false);
    expect(pruneFinishedItems(s, T0 + 1000 + FINISHED_ITEM_TTL_MS)).toBe(true);
    expect(s.items).toHaveLength(0);
  });

  it('counts failures and cancellations even when the item is unknown', () => {
    const s = createSnapshot(record, T0);
    applyEvent(s, { event_name: 'item.fail', message: { pipeline_id: 1, item_id: 'nope' } }, T0);
    applyEvent(s, { event_name: 'item.cancel', message: { pipeline_id: 1, item_id: 'nope' } }, T0);
    expect(s.counters).toEqual({ completed: 0, failed: 1, canceled: 1 });
  });

  it('ignores output for unknown items without touching the snapshot', () => {
    const s = createSnapshot(record, T0);
    expect(
      applyEvent(s, { event_name: 'item.output', message: { item_id: 'nope', data: 'x' } }, T0 + 5),
    ).toBe(false);
    expect(s.updatedAt).toBe(T0);
  });

  it('keeps only the log tail', () => {
    const s = createSnapshot(record, T0);
    applyEvent(s, { event_name: 'pipeline.start_item', message: { pipeline_id: 1, item } }, T0);
    for (let i = 0; i < LOG_TAIL_LINES + 10; i++) {
      applyEvent(
        s,
        { event_name: 'item.output', message: { item_id: 'abc-1', data: `line ${i}\n` } },
        T0,
      );
    }
    const lines = s.items[0]!.logTail.split('\n');
    expect(lines.length).toBeLessThanOrEqual(LOG_TAIL_LINES);
    expect(lines).toContain(`line ${LOG_TAIL_LINES + 9}`);
  });

  it('caps the log tail by characters when lines are long', () => {
    const s = createSnapshot(record, T0);
    applyEvent(s, { event_name: 'pipeline.start_item', message: { pipeline_id: 1, item } }, T0);
    for (let i = 0; i < 10; i++) {
      applyEvent(
        s,
        {
          event_name: 'item.output',
          message: { item_id: 'abc-1', data: `${i}:${'u'.repeat(1500)}\n` },
        },
        T0,
      );
    }
    const tail = s.items[0]!.logTail;
    expect(tail.length).toBeLessThanOrEqual(LOG_TAIL_CHARS);
    expect(tail.startsWith('5:')).toBe(true);
    expect(tail.endsWith('9:' + 'u'.repeat(1500) + '\n')).toBe(true);
  });
});

describe('bandwidth and status', () => {
  it('caps bandwidth history', () => {
    const s = createSnapshot(record, T0);
    for (let i = 0; i < BANDWIDTH_HISTORY + 20; i++) {
      applyEvent(
        s,
        { event_name: 'bandwidth', message: { received: i, sent: i, receiving: 1, sending: 1 } },
        T0 + i,
      );
    }
    expect(s.bandwidthHistory).toHaveLength(BANDWIDTH_HISTORY);
    expect(s.bandwidthHistory[0]?.received).toBe(20);
  });

  it('clears project and items when the warrior reports NO_PROJECT', () => {
    const s = connected();
    applyEvent(s, { event_name: 'warrior.status', message: { status: 'NO_PROJECT' } }, T0);
    expect(s.project).toBeNull();
    expect(s.items).toHaveLength(0);
  });

  it('drops items when the instance id changes (warrior restarted)', () => {
    const s = connected();
    applyEvent(s, { event_name: 'instance_id', message: '9-0.1' }, T0);
    expect(s.items).toHaveLength(0);
  });

  it('timestamp events do not mark the snapshot as changed', () => {
    const s = connected();
    expect(applyEvent(s, { event_name: 'timestamp', message: { timestamp: 1 } }, T0 + 1)).toBe(
      false,
    );
    expect(s.connection.lastSeenAt).toBe(T0 + 1);
  });
});

describe('helpers', () => {
  it('stripCarriageReturns drops overwritten progress lines', () => {
    expect(stripCarriageReturns('10%\r20%\r30%\n')).toBe('30%\n');
    expect(stripCarriageReturns('a\r\nb')).toBe('a\r\nb');
  });

  it('tailLines keeps the last N lines', () => {
    expect(tailLines('a\nb\nc\nd', 2)).toBe('c\nd');
    expect(tailLines('a\nb', 5)).toBe('a\nb');
    expect(tailLines('a\nb\nc\n', 2)).toBe('c\n');
    expect(tailLines('\na', 1)).toBe('a');
    expect(tailLines('\n', 1)).toBe('');
    expect(tailLines('', 3)).toBe('');
    expect(tailLines('abc', 1)).toBe('abc');
  });

  it('tailLines matches a split-based tail for a stream of uneven chunks', () => {
    const reference = (text: string, max: number) => {
      const lines = text.split('\n');
      return lines.length <= max ? text : lines.slice(lines.length - max).join('\n');
    };
    const chunks = ['a', 'b\n', '\n\n', 'c\nd\ne', 'f', '\ng\n', 'h\n\ni', '\n', 'j'];
    for (const max of [1, 2, 3, 5]) {
      let fast = '';
      let slow = '';
      for (let round = 0; round < 4; round++) {
        for (const chunk of chunks) {
          fast = tailLines(fast + chunk, max);
          slow = reference(slow + chunk, max);
          expect(fast).toBe(slow);
        }
      }
    }
  });

  it('tailLines cuts to the character cap at a line boundary', () => {
    expect(tailLines('aaaa\nbbbb\ncc', 10, 8)).toBe('bbbb\ncc');
    // A cut that lands mid-line drops the rest of that line.
    expect(tailLines('aaaa\nbbbb\ncc', 10, 9)).toBe('bbbb\ncc');
    // A single line longer than the cap keeps its last characters.
    expect(tailLines('x'.repeat(20), 10, 8)).toBe('x'.repeat(8));
    // So does a single line with a trailing newline.
    expect(tailLines('x'.repeat(20) + '\n', 10, 8)).toBe('x'.repeat(7) + '\n');
  });
});

describe('project lifecycle events', () => {
  it('switches the project from the catalog on project_selected and re-resolves after projects_loaded', () => {
    const s = connected();
    expect(
      applyEvent(
        s,
        { event_name: 'warrior.project_selected', message: { project: 'telegram' } },
        T0,
      ),
    ).toBe(true);
    expect(s.project?.title).toBe('Telegram');
    // A deselect announces null; the status and refresh that follow carry the real change.
    expect(
      applyEvent(s, { event_name: 'warrior.project_selected', message: { project: null } }, T0),
    ).toBe(false);
    expect(s.project?.title).toBe('Telegram');
    expect(
      applyEvent(
        s,
        { event_name: 'warrior.project_installing', message: { project: { name: 'unknown' } } },
        T0,
      ),
    ).toBe(false);

    const fresh = createSnapshot(record, T0);
    applyEvent(
      fresh,
      {
        event_name: 'project.refresh',
        message: {
          status: 'running',
          items: [],
          project: {
            project_id: 1,
            title: 'URLTeam 2',
            project_html: '',
            utc_deadline: '2030-01-01',
          },
        },
      },
      T0,
    );
    expect(fresh.project?.name).toBeNull();
    applyEvent(
      fresh,
      events.find((e) => e.event_name === 'warrior.projects_loaded')!,
      T0,
    );
    expect(fresh.project?.name).toBe('urlteam2');
    expect(fresh.project?.deadline).toBe('2030-01-01');
  });

  it('ignores events that carry nothing for the snapshot', () => {
    const s = connected();
    expect(applyEvent(s, { event_name: 'warrior.settings_update', message: {} }, T0 + 1)).toBe(
      false,
    );
    expect(
      applyEvent(
        s,
        { event_name: 'warrior.project_installation_failed', message: { project: { name: 'x' } } },
        T0 + 1,
      ),
    ).toBe(false);
    expect(applyEvent(s, { event_name: 'project.refresh', message: null }, T0 + 1)).toBe(false);
    expect(
      applyEvent(
        s,
        {
          event_name: 'item.task_status',
          message: {
            item_id: s.items[0]!.id,
            task_id: -1,
            new_status: 'running',
            old_status: null,
          },
        },
        T0 + 1,
      ),
    ).toBe(false);
    expect(
      applyEvent(
        s,
        { event_name: 'item.update_name', message: { item_id: 'nope', new_name: 'x' } },
        T0 + 1,
      ),
    ).toBe(false);
  });

  it('keeps running items through a project change whose refresh lists none', () => {
    const s = connected();
    expect(s.items).toHaveLength(3);
    applyEvent(
      s,
      { event_name: 'item.complete', message: { pipeline_id: 1, item_id: s.items[0]!.id } },
      T0 + 1,
    );
    applyEvent(
      s,
      {
        event_name: 'project.refresh',
        message: {
          status: 'running',
          items: [],
          project: { project_id: 2, title: 'Telegram', project_html: '', utc_deadline: null },
        },
      },
      T0 + 2,
    );
    expect(s.project?.name).toBe('telegram');
    // The two unfinished items stay; the completed one is dropped with the old list.
    expect(s.items.map((i) => i.status)).toEqual(['running', 'running']);
    applyEvent(
      s,
      { event_name: 'item.complete', message: { pipeline_id: 1, item_id: s.items[0]!.id } },
      T0 + 3,
    );
    expect(s.counters.completed).toBe(2);
    // A refresh that does list items is authoritative, as on a fresh connection.
    applyEvent(
      s,
      {
        event_name: 'project.refresh',
        message: {
          status: 'running',
          items: [
            {
              id: 'n1',
              name: 'n1',
              number: 9,
              status: 'running',
              tasks: [],
              output: '',
              project: 'telegram',
              start_time: 1,
            },
          ],
          project: { project_id: 2, title: 'Telegram', project_html: '', utc_deadline: null },
        },
      },
      T0 + 4,
    );
    expect(s.items.map((i) => i.id)).toEqual(['n1']);
  });

  it('keeps a running item when a refresh reports it finished', () => {
    const s = createSnapshot(record, T0);
    applyEvent(
      s,
      {
        event_name: 'project.refresh',
        message: {
          status: 'running',
          items: [
            {
              id: 'a',
              name: 'a',
              number: 1,
              status: 'completed',
              tasks: [],
              output: 'done\n',
              project: 'p',
              start_time: 1,
            },
          ],
          project: null,
        },
      },
      T0,
    );
    expect(s.items[0]?.finishedAt).toBe(T0);
    expect(s.items[0]?.logTail).toBe('done\n');
    expect(s.project).toBeNull();
  });
});

describe('resetLiveState and item replacement', () => {
  it('clears what a fresh connection re-sends but keeps history, catalog, and counters', () => {
    const s = connected();
    s.counters.completed = 4;
    resetLiveState(s, T0 + 1);
    expect(s.instanceId).toBeNull();
    expect(s.items).toEqual([]);
    expect(s.bandwidth).toBeNull();
    expect(s.bandwidthHistory).toHaveLength(1);
    expect(Object.keys(s.catalog).length).toBeGreaterThan(0);
    expect(s.counters.completed).toBe(4);
    expect(s.updatedAt).toBe(T0 + 1);
  });

  it('replaces an item that starts again under the same id', () => {
    const s = connected();
    const existing = s.items[0]!;
    applyEvent(
      s,
      {
        event_name: 'pipeline.start_item',
        message: {
          pipeline_id: 1,
          item: {
            id: existing.id,
            name: 'restarted',
            number: existing.number,
            status: 'running',
            tasks: [],
            output: '',
            project: 'p',
            start_time: T0,
          },
        },
      },
      T0,
    );
    expect(s.items).toHaveLength(3);
    expect(s.items.at(-1)?.name).toBe('restarted');
    expect(s.items.filter((i) => i.id === existing.id)).toHaveLength(1);
  });
});
