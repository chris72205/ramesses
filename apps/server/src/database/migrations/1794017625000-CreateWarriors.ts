import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWarriors1794017625000 implements MigrationInterface {
  name = 'CreateWarriors1794017625000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "warriors" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "host" text NOT NULL,
        "port" integer NOT NULL DEFAULT 8001,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_warriors_host_port" UNIQUE ("host", "port")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "warriors"`);
  }
}
