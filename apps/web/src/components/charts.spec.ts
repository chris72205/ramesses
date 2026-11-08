import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { formatCount } from '../lib/format';
import HealthBadge from './HealthBadge.svelte';
import HistoryChart from './HistoryChart.svelte';
import Sparkline from './Sparkline.svelte';

const T0 = Date.parse('2026-11-07T10:00:00Z');

describe('HealthBadge', () => {
  it('labels every state with text, not color alone', () => {
    for (const [health, label] of [
      ['backlog', 'Backlog'],
      ['healthy', 'Healthy'],
      ['intermittent', 'Intermittent'],
      ['drained', 'Drained'],
      ['unknown', 'Unknown'],
    ] as const) {
      const { unmount } = render(HealthBadge, { health });
      expect(screen.getByText(label)).toHaveAttribute('title');
      unmount();
    }
  });
});

describe('Sparkline', () => {
  const points = Array.from({ length: 4 }, (_, i) => ({
    at: new Date(T0 + i * 900_000).toISOString(),
    value: (i + 1) * 100,
  }));

  it('shows a dash for fewer than two points', () => {
    render(Sparkline, {
      points: points.slice(0, 1),
      color: 'red',
      format: formatCount,
      label: 'x',
    });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('clamps hover positions to the first and last points', async () => {
    render(Sparkline, {
      points: points.slice(0, 2),
      color: 'red',
      format: formatCount,
      label: 'Two',
    });
    const svg = screen.getByRole('img', { name: 'Two, peak 200' });
    svg.getBoundingClientRect = () => ({ left: 0, width: 120 }) as DOMRect;
    await fireEvent.mouseMove(svg, { clientX: -50 });
    expect(screen.getByText('100')).toBeInTheDocument();
    await fireEvent.mouseMove(svg, { clientX: 500 });
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('draws the series and reports the hovered value', async () => {
    render(Sparkline, { points, color: 'red', format: formatCount, label: 'Rate' });
    const svg = screen.getByRole('img', { name: 'Rate, peak 400' });
    svg.getBoundingClientRect = () => ({ left: 0, width: 120 }) as DOMRect;
    await fireEvent.mouseMove(svg, { clientX: 120 });
    expect(screen.getByText('400')).toBeInTheDocument();
    await fireEvent.mouseLeave(svg);
    expect(screen.queryByText('400')).not.toBeInTheDocument();
  });
});

describe('HistoryChart', () => {
  const points = [
    { at: T0, value: null },
    { at: T0 + 900_000, value: 1200 },
    { at: T0 + 1_800_000, value: 1800 },
    { at: T0 + 2_700_000, value: null },
    { at: T0 + 3_600_000, value: 2400 },
  ];

  it('renders an empty state without values', () => {
    render(HistoryChart, {
      title: 'Rate',
      points: [{ at: T0, value: null }],
      color: 'red',
      format: formatCount,
    });
    expect(screen.getByText('No samples in this range yet')).toBeInTheDocument();
  });

  it('draws segments around gaps, clean ticks, a crosshair tooltip, and a table view', async () => {
    render(HistoryChart, { title: 'Rate', points, color: 'red', format: formatCount });
    const svg = screen.getByRole('img', { name: /Rate: 3 samples, latest 2,400/ });
    expect(svg.querySelectorAll('path[fill="none"]')).toHaveLength(2); // two runs of values
    expect(screen.getByText('3,000')).toBeInTheDocument(); // ticks every 1,000 up past 2,400
    expect(screen.queryByText('1,500')).not.toBeInTheDocument();
    expect(screen.getByText('now 2,400')).toBeInTheDocument();

    svg.getBoundingClientRect = () => ({ left: 0, width: 600 }) as DOMRect;
    await fireEvent.pointerMove(svg, { clientX: 0 });
    expect(screen.getByText('no rate')).toBeInTheDocument(); // first point has no value
    await fireEvent.pointerMove(svg, { clientX: 600 });
    expect(screen.getByRole('strong')).toHaveTextContent('2,400');
    await fireEvent.pointerLeave(svg);
    expect(screen.queryByRole('strong')).not.toBeInTheDocument();

    // jsdom does not toggle <details> on click; open it the way a browser would and notify Svelte.
    const details = screen.getByText('Show as table').closest('details')!;
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('keeps the tooltip inside the plot by flipping sides', async () => {
    render(HistoryChart, { title: 'Rate', points, color: 'red', format: formatCount });
    const svg = screen.getByRole('img', { name: /Rate:/ });
    svg.getBoundingClientRect = () => ({ left: 0, width: 600 }) as DOMRect;
    await fireEvent.pointerMove(svg, { clientX: 100 });
    expect(screen.getByRole('strong').parentElement).toHaveStyle({ right: '8px' });
    await fireEvent.pointerMove(svg, { clientX: 590 });
    expect(screen.getByRole('strong').parentElement).toHaveStyle({ left: '8px' });
    // a hovered point without a value gets no marker, only the crosshair
    await fireEvent.pointerMove(svg, { clientX: 0 });
    expect(svg.querySelectorAll('circle')).toHaveLength(1); // the end marker only
    await fireEvent.pointerMove(svg, { clientX: 590 });
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
  });

  it('labels a multi-day range with dates', () => {
    const days = [0, 1, 2, 3].map((d) => ({ at: T0 + d * 86_400_000, value: 10 }));
    render(HistoryChart, { title: 'Todo', points: days, color: 'red', format: formatCount });
    expect(screen.getAllByText(/Nov \d+/).length).toBeGreaterThan(0);
  });
});
