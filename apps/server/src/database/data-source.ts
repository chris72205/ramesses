import { DataSource, type DataSourceOptions } from 'typeorm';
import { ProjectStat } from '../projects/project-stat.entity';
import { Project } from '../projects/project.entity';
import { Warrior } from '../warriors/warrior.entity';
import * as migrations from './migrations';

export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [Warrior, Project, ProjectStat],
    migrations: Object.values(migrations),
    migrationsRun: true,
    synchronize: false,
    logging: ['error', 'warn', 'migration'],
  };
}

/** Standalone data source for the migrate script. */
export function createDataSource(url: string): DataSource {
  return new DataSource(dataSourceOptions(url));
}
