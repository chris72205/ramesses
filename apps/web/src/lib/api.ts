import type { CreateWarriorInput, UpdateWarriorInput, WarriorRecord } from '@ramesses/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (body.message)
        message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    } catch {
      // keep statusText
    }
    throw new ApiError(response.status, message);
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
