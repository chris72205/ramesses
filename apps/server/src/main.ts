import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import { createApp } from './app';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.PORT, '0.0.0.0');
  app
    .get(Logger)
    .log(`Ramesses backend listening on http://localhost:${env.PORT} (docs at /api/docs)`);
}

void bootstrap();
