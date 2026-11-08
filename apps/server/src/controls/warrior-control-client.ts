import type { WarriorSettings } from '@ramesses/shared';
import { parseSettingsFragment, toWarriorSettings } from './settings-fragment';

/**
 * HTTP client for a warrior's control endpoints, `POST /api/<command>` with url-encoded form fields.
 *
 * The warrior answers `200 OK` as soon as it has accepted a command and does the work afterwards,
 * so a success here means "accepted", never "done": the outcome shows up on the warrior's event
 * stream. The three commands Ramesses uses are `select-project` (field `project_name`, which must
 * be a key of the warrior's own catalog: an unknown name is saved and acts as a deselect),
 * `deselect-project`, and `settings` (every posted field is a config key; rejections come back
 * inside the HTML fragment with HTTP 200).
 *
 * The warrior has three more commands that Ramesses deliberately never calls: `stop` finishes the
 * items in flight and then exits the process (on an idle warrior, immediately), `stop_now` exits
 * at once and loses the items in flight, and `keep_running` cancels a shutdown that is still
 * draining. None of them is needed to take a warrior off a project, which is what "stop working"
 * means here; the Docker container is left for the operator to handle.
 */

export interface WarriorAddress {
  host: string;
  port: number;
}

export interface WarriorCredentials {
  username: string;
  password: string;
}

export type WarriorControlErrorKind =
  /** no HTTP response at all: refused, reset, name resolution, timeout */
  | 'unreachable'
  /** 401: the warrior has a password and nothing was sent or it was wrong */
  | 'unauthorized'
  /** any other non-2xx status */
  | 'rejected'
  /** 200 without the `OK` body: the command name was not recognized */
  | 'unexpected_body';

export class WarriorControlError extends Error {
  constructor(
    readonly kind: WarriorControlErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WarriorControlError';
  }
}

export interface SettingsWriteResult {
  ok: boolean;
  /** warrior message per rejected config key, empty when `ok` */
  errors: Record<string, string>;
  settings: WarriorSettings;
}

export interface WarriorControlClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** delay before the single retry after a connection failure */
  retryDelayMs?: number;
  userAgent?: string;
  /** supplies basic-auth credentials for a warrior, or null for none */
  credentials?: (address: WarriorAddress) => WarriorCredentials | null;
}

export const CONTROL_USER_AGENT = 'ramesses/0.1.0 (+https://github.com/chris72205/ramesses)';
export const WARRIOR_CONTROL_CLIENT = Symbol('WARRIOR_CONTROL_CLIENT');

export class WarriorControlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly userAgent: string;
  private readonly credentials: (address: WarriorAddress) => WarriorCredentials | null;

  constructor(options: WarriorControlClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.userAgent = options.userAgent ?? CONTROL_USER_AGENT;
    this.credentials = options.credentials ?? (() => null);
  }

  /** Ask the warrior to work on `name`. The caller has already checked it is in the catalog. */
  public async selectProject(address: WarriorAddress, name: string): Promise<void> {
    await this.command(address, 'select-project', { project_name: name });
  }

  /** Ask the warrior to finish its items and then sit idle. */
  public async deselectProject(address: WarriorAddress): Promise<void> {
    await this.command(address, 'deselect-project', {});
  }

  /** Post only the given config keys; the warrior leaves the others alone. */
  public async updateSettings(
    address: WarriorAddress,
    values: Record<string, string>,
  ): Promise<SettingsWriteResult> {
    const response = await this.request(address, 'POST', 'settings', values);
    const parsed = parseSettingsFragment(await response.text());
    return {
      ok: Object.keys(parsed.errors).length === 0,
      errors: parsed.errors,
      settings: toWarriorSettings(parsed.values),
    };
  }

  public async readSettings(address: WarriorAddress): Promise<WarriorSettings> {
    const response = await this.request(address, 'GET', 'settings');
    return toWarriorSettings(parseSettingsFragment(await response.text()).values);
  }

  private async command(
    address: WarriorAddress,
    command: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const response = await this.request(address, 'POST', command, fields);
    const body = (await response.text()).trim();
    if (body !== 'OK') {
      throw new WarriorControlError(
        'unexpected_body',
        `warrior did not acknowledge ${command}: ${body ? JSON.stringify(body.slice(0, 80)) : 'empty body'}`,
        response.status,
      );
    }
  }

  /** One request with a timeout and a single retry when no response arrived at all. */
  private async request(
    address: WarriorAddress,
    method: 'GET' | 'POST',
    command: string,
    fields?: Record<string, string>,
  ): Promise<Response> {
    const url = `http://${address.host}:${address.port}/api/${command}`;
    const headers: Record<string, string> = { 'user-agent': this.userAgent, accept: 'text/html' };
    const credentials = this.credentials(address);
    if (credentials) {
      const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString(
        'base64',
      );
      headers.authorization = `Basic ${token}`;
    }
    const init: RequestInit = { method, headers };
    if (fields) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(fields).toString();
    }
    let response: Response;
    try {
      response = await this.send(url, init);
    } catch (first) {
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      try {
        response = await this.send(url, init);
      } catch {
        throw new WarriorControlError('unreachable', describe(first));
      }
    }
    if (response.status === 401) {
      throw new WarriorControlError('unauthorized', 'warrior requires credentials', 401);
    }
    if (!response.ok) {
      throw new WarriorControlError(
        'rejected',
        `warrior answered HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'no response within the timeout';
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return error.message;
  }
  return String(error);
}
