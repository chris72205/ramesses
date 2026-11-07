import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as migrations from './index';

const MIGRATION_FILE = /^(\d{13})-([A-Za-z0-9]+)\.ts$/;

describe('migrations barrel', () => {
  const files = readdirSync(__dirname).filter((file) => MIGRATION_FILE.test(file));
  const exported = Object.values(migrations) as Array<new () => { name?: string }>;

  it('contains at least one migration', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('exports every migration file in this directory', () => {
    const exportedNames = exported.map((migration) => new migration().name);
    for (const file of files) {
      const [, timestamp, title] = MIGRATION_FILE.exec(file)!;
      expect(exportedNames, `${file} is not exported from migrations/index.ts`).toContain(
        `${title}${timestamp}`,
      );
    }
  });

  it('exports nothing but migrations', () => {
    expect(exported).toHaveLength(files.length);
    for (const migration of exported) {
      const instance = new migration() as Record<string, unknown>;
      expect(typeof instance.up).toBe('function');
      expect(typeof instance.down).toBe('function');
    }
  });
});
