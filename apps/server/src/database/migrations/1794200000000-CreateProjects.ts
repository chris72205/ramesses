import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1794200000000 implements MigrationInterface {
  name = 'CreateProjects1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "name" text PRIMARY KEY,
        "title" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "logo" text,
        "leaderboard" text,
        "repository" text,
        "tracker" text NOT NULL DEFAULT 'unknown',
        "is_auto" boolean NOT NULL DEFAULT false,
        "listed" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "deadline" timestamptz,
        "first_seen_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "last_sampled_at" timestamptz,
        "last_error" text,
        "last_error_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "project_stats" (
        "id" bigserial PRIMARY KEY,
        "project_name" text NOT NULL REFERENCES "projects" ("name") ON DELETE CASCADE,
        "sampled_at" timestamptz NOT NULL,
        "todo" bigint NOT NULL,
        "out" bigint NOT NULL,
        "done" bigint NOT NULL,
        "rcr" double precision,
        "downloader_count" integer NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_project_stats_project_sampled"
        ON "project_stats" ("project_name", "sampled_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_stats"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
