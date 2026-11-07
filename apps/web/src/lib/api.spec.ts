import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function respond(status: number, body?: unknown, statusText = 'Status') {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('lists warriors', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, [{ id: '1' }]));
    expect(await api.listWarriors()).toEqual([{ id: '1' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/warriors',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('posts, patches, and deletes with JSON bodies', async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { id: '1', host: 'h' }));
    await api.createWarrior({ host: 'h', port: 1 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ host: 'h', port: 1 }),
    });

    fetchMock.mockResolvedValueOnce(respond(200, { id: '1', enabled: false }));
    await api.updateWarrior('1', { enabled: false });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/warriors/1');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deleteWarrior('1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('turns error responses into ApiError with the server message', async () => {
    fetchMock.mockResolvedValueOnce(
      respond(400, { message: ['host must be a hostname', 'port too big'] }),
    );
    await expect(api.createWarrior({ host: '!' })).rejects.toMatchObject({
      status: 400,
      message: 'host must be a hostname; port too big',
    });

    fetchMock.mockResolvedValueOnce(respond(409, { message: 'exists' }));
    const error = await api.createWarrior({ host: 'h' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('exists');

    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 500, statusText: 'Boom' }));
    await expect(api.listWarriors()).rejects.toMatchObject({ status: 500, message: 'Boom' });
  });
});
