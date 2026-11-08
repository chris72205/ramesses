import type {
  ControlAccepted,
  CreateWarriorInput,
  HistoryRange,
  ProjectDetail,
  ProjectHistory,
  ProjectSummary,
  RefreshResult,
  UpdateWarriorInput,
  UpdateWarriorSettingsInput,
  WarriorRecord,
  WarriorSettings,
} from '@ramesses/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** per-field messages, when the server rejected individual fields (422) */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Fastify rejects a JSON content-type with an empty body, so only send it alongside one.
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = response.statusText;
    let fields: Record<string, string> = {};
    try {
      const body = (await response.json()) as {
        message?: string | string[];
        fields?: Record<string, string>;
      };
      if (body.message)
        message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
      if (body.fields) fields = body.fields;
    } catch {
      // keep statusText
    }
    throw new ApiError(response.status, message, fields);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  listWarriors: () => request<WarriorRecord[]>('/api/warriors'),
  createWarrior: (input: CreateWarriorInput) =>
    request<WarriorRecord>('/api/warriors', { method: 'POST', body: JSON.stringify(input) }),
  updateWarrior: (id: string, input: UpdateWarriorInput) =>
    request<WarriorRecord>(`/api/warriors/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteWarrior: (id: string) => request<void>(`/api/warriors/${id}`, { method: 'DELETE' }),
  listProjects: (includeHidden = false) =>
    request<ProjectSummary[]>(`/api/projects${includeHidden ? '?includeHidden=true' : ''}`),
  getProject: (name: string) => request<ProjectDetail>(`/api/projects/${encodeURIComponent(name)}`),
  getProjectHistory: (name: string, range: HistoryRange) =>
    request<ProjectHistory>(`/api/projects/${encodeURIComponent(name)}/history?range=${range}`),
  refreshProjects: () => request<RefreshResult>('/api/projects/refresh', { method: 'POST' }),
  selectProject: (id: string, name: string) =>
    request<ControlAccepted>(`/api/warriors/${id}/project`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  deselectProject: (id: string) =>
    request<ControlAccepted>(`/api/warriors/${id}/project`, { method: 'DELETE' }),
  getSettings: (id: string) => request<WarriorSettings>(`/api/warriors/${id}/settings`),
  updateSettings: (id: string, input: UpdateWarriorSettingsInput) =>
    request<ControlAccepted>(`/api/warriors/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

/** Parse one `host[:port]` line into a create payload. Returns null for blank lines. */
export function parseHostLine(line: string): CreateWarriorInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match) return { host: trimmed };
  const [, host, port] = match;
  return port ? { host: host!, port: Number(port) } : { host: host! };
}
