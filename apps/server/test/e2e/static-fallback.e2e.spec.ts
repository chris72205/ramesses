import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestApp } from '../support/app';

let app: NestFastifyApplication | undefined;

beforeAll(async () => {
  // A stand-in for the built web app: an index page and one asset.
  const dist = mkdtempSync(path.join(tmpdir(), 'ramesses-web-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(
    path.join(dist, 'index.html'),
    '<!doctype html><title>Ramesses</title><div id="app"></div>',
  );
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("app")');
  ({ app } = await bootTestApp({ WEB_DIST: dist }));
});

afterAll(async () => {
  await app?.close();
});

describe('serving the web app from the backend', () => {
  it('serves real files and falls back to index.html for client-side routes', async () => {
    const index = await app!.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toMatch(/text\/html/);

    const asset = await app!.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('console.log');

    for (const url of ['/projects', '/projects/blogger', '/nowhere']) {
      const res = await app!.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/text\/html/);
      expect(res.body, url).toContain('id="app"');
    }
  });

  it('keeps unknown API paths as JSON 404s while real API routes still answer', async () => {
    for (const url of ['/api/does-not-exist', '/api/projects/nope/extra', '/api']) {
      const res = await app!.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/application\/json/);
      expect(res.json(), url).toMatchObject({ statusCode: 404 });
    }
    const posted = await app!.inject({ method: 'POST', url: '/api/nothing', payload: {} });
    expect(posted.statusCode).toBe(404);
    const live = await app!.inject({ method: 'GET', url: '/api/health/live' });
    expect(live.statusCode).toBe(200);
  });
});
