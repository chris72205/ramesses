import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env';
import { LeaderModule } from '../leader/leader.module';
import { RedisModule } from '../redis/redis.module';
import { ProjectStat } from './project-stat.entity';
import { Project } from './project.entity';
import { ProjectsSampler } from './projects-sampler.service';
import { ProjectsScheduler } from './projects-scheduler.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { HttpTrackerClient, TRACKER_CLIENT } from './tracker/tracker-client';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectStat]), RedisModule, LeaderModule],
  controllers: [ProjectsController],
  providers: [
    {
      provide: TRACKER_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new HttpTrackerClient({
          projectsUrl: config.get('TRACKER_PROJECTS_URL', { infer: true }),
          statsUrlTemplate: config.get('TRACKER_STATS_URL_TEMPLATE', { infer: true }),
        }),
    },
    ProjectsSampler,
    ProjectsScheduler,
    ProjectsService,
  ],
  exports: [ProjectsService, ProjectsScheduler],
})
export class ProjectsModule {}
