import 'reflect-metadata';
import { loadEnv } from '../config/env';
import { createDataSource } from './data-source';

async function main(): Promise<void> {
  const env = loadEnv();
  const dataSource = createDataSource(env.DATABASE_URL);
  await dataSource.initialize();
  const direction = process.argv[2] === 'revert' ? 'revert' : 'run';
  if (direction === 'revert') {
    await dataSource.undoLastMigration();
    console.log('Reverted last migration');
  } else {
    const applied = await dataSource.runMigrations();
    console.log(
      applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'Up to date',
    );
  }
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
