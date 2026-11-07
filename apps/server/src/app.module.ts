import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { LoggerModule } from 'nestjs-pino';
import { envSchema, loadEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { FleetModule } from './fleet/fleet.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { WarriorsModule } from './warriors/warriors.module';

const env = loadEnv();
const isProduction = env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (config) => envSchema.parse(config) }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        transport: isProduction
          ? undefined
          : { target: 'pino-pretty', options: { singleLine: true } },
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      },
    }),
    ...(env.WEB_DIST
      ? [ServeStaticModule.forRoot({ rootPath: env.WEB_DIST, exclude: ['/api/{*path}', '/ws'] })]
      : []),
    DatabaseModule,
    RedisModule,
    HealthModule,
    WarriorsModule,
    FleetModule,
  ],
})
export class AppModule {}
