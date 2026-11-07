import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BandwidthSparkline from './BandwidthSparkline.svelte';

const start = new Date(2026, 0, 1, 14, 5, 0).getTime();
const history = Array.from({ length: 10 }, (_, i) => ({
  at: start + i * 1000,
  received: 0,
  sent: 0,
  receiving: i * 100,
  sending: 50,
}));

describe('BandwidthSparkline', () => {
  it('draws both series and shows a tooltip for the hovered sample', async () => {
    const { container } = render(BandwidthSparkline, { history });
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('last 10 s'));
    expect(container.textContent).toContain('last 10 s');
    expect(container.querySelectorAll('path')).toHaveLength(2);
    svg.getBoundingClientRect = () => ({
      left: 0,
      width: 100,
      top: 0,
      height: 48,
      right: 100,
      bottom: 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await fireEvent.mouseMove(svg, { clientX: 100 });
    expect(container.textContent).toContain('14:05:09');
    expect(container.textContent).not.toContain('last 10 s');
    expect(container.textContent).toContain('900 B/s');
    expect(container.textContent).toContain('50 B/s');
    await fireEvent.mouseLeave(svg);
    expect(container.textContent).not.toContain('900 B/s');
    expect(container.textContent).toContain('last 10 s');
  });

  it('handles an empty or single-sample history', () => {
    render(BandwidthSparkline, { history: [] });
    expect(screen.getByRole('img')).toBeInTheDocument();
    render(BandwidthSparkline, { history: [history[0]!] });
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
