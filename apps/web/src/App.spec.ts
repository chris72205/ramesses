import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@ramesses/shared';
import App from './App.svelte';
import type * as ApiModule from './lib/api';
import { warriors } from './lib/warriors.svelte';

const mocks = vi.hoisted(() => ({
  listWarriors: vi.fn(),
  createWarrior: vi.fn(),
  updateWarrior: vi.fn(),
  deleteWarrior: vi.fn(),
  listProjects: vi.fn(),
  getProjectHistory: vi.fn(),
  refreshProjects: vi.fn(),
}));
vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: mocks };
});

class FakeWebSocket {
  static last: FakeWebSocket | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }
  public close() {}
  public push(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const totals = {
  warriors: 0,
  enabled: 0,
  connected: 0,
  receiving: 0,
  sending: 0,
  received: 0,
  sent: 0,
  itemsInFlight: 0,
  completed: 0,
  failed: 0,
  projects: [],
  rollingWindowMs: 300_000,
  avgReceiving: 0,
  avgSending: 0,
};

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // The warrior list is a module-level store; start each test before the first load.
    warriors.records = null;
    warriors.error = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.listWarriors.mockReset();
  });

  it('shows setup on first run, then the dashboard once warriors exist', async () => {
    mocks.listWarriors.mockResolvedValueOnce([]);
    render(App);
    expect(await screen.findByRole('heading', { name: 'Add your warriors' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows the dashboard when warriors exist and renders pushed state', async () => {
    mocks.listWarriors.mockResolvedValueOnce([
      { id: 'w1', name: 'one', host: 'h', port: 8001, enabled: true, createdAt: '', updatedAt: '' },
    ]);
    render(App);
    expect(await screen.findByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    FakeWebSocket.last!.onopen?.();
    FakeWebSocket.last!.push({ type: 'hello', warriors: [], fleet: totals, projects: [] });
    expect(await screen.findByText(/No warriors yet/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('reports a backend error with a retry button', async () => {
    mocks.listWarriors.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce([]);
    render(App);
    expect(
      await screen.findByText(/Could not reach the backend: ECONNREFUSED/),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
  });

  it('routes to the projects page and back, and shows a not-found page', async () => {
    mocks.listWarriors.mockResolvedValue([
      { id: 'w1', name: 'one', host: 'h', port: 8001, enabled: true, createdAt: '', updatedAt: '' },
    ]);
    mocks.listProjects.mockResolvedValue([]);
    history.pushState({}, '', '/projects');
    try {
      render(App);
      expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Projects' })).toHaveClass('tab-active');
      expect(screen.getByRole('tab', { name: 'Dashboard' })).not.toHaveClass('tab-active');
      expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
    } finally {
      history.pushState({}, '', '/');
    }
  });

  it('renders the not-found page for unknown paths', async () => {
    mocks.listWarriors.mockResolvedValue([
      { id: 'w1', name: 'one', host: 'h', port: 8001, enabled: true, createdAt: '', updatedAt: '' },
    ]);
    history.pushState({}, '', '/nowhere/at/all');
    try {
      render(App);
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
        'href',
        '/',
      );
    } finally {
      history.pushState({}, '', '/');
    }
  });

  it('routes to the settings page, which manages the warrior list', async () => {
    mocks.listWarriors.mockResolvedValue([
      { id: 'w1', name: 'one', host: 'h', port: 8001, enabled: true, createdAt: '', updatedAt: '' },
    ]);
    history.pushState({}, '', '/settings');
    try {
      render(App);
      expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Settings' })).toHaveClass('tab-active');
      expect(await screen.findByRole('cell', { name: /^one\b/ })).toBeInTheDocument();
      expect(screen.getByLabelText('Enabled')).toBeChecked();
    } finally {
      history.pushState({}, '', '/');
    }
  });
});
