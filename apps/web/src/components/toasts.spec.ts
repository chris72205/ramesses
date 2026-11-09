import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { notifications } from '../lib/notifications.svelte';
import Toasts from './Toasts.svelte';

describe('Toasts', () => {
  afterEach(() => notifications.clear());

  it('renders nothing while there is no notice', () => {
    render(Toasts);
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('shows each notice with the role its level calls for, newest last', async () => {
    render(Toasts);
    notifications.success('Saved');
    notifications.info('Sampled');
    notifications.error('Failed');
    const region = await screen.findByRole('region', { name: 'Notifications' });
    expect(region).toHaveClass('toast-bottom', 'toast-center', 'sm:toast-end');
    const statuses = screen.getAllByRole('status');
    expect(statuses.map((s) => s.textContent?.trim())).toEqual(['Saved ✕', 'Sampled ✕']);
    expect(statuses[0]).toHaveClass('alert-success');
    expect(statuses[1]).toHaveClass('alert-info');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByRole('alert')).toHaveClass('alert-error');
  });

  it('dismisses a notice from its button', async () => {
    render(Toasts);
    notifications.error('Failed');
    await screen.findByRole('alert');
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });
});
