import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetadataNormalizationFields1783915200000 implements MigrationInterface {
  name = 'AddMetadataNormalizationFields1783915200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      ADD COLUMN "normalizationVersion" varchar(64),
      ADD COLUMN "normalizationDetails" jsonb,
      ADD COLUMN "normalizedAt" timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_raw_match_metadata_normalization_version"
      ON "raw_match_metadata" ("normalizationVersion")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_raw_match_metadata_processing_version"
      ON "raw_match_metadata" ("processingVersion")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_raw_match_metadata_processing_version"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_raw_match_metadata_normalization_version"',
    );
    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      DROP COLUMN IF EXISTS "normalizedAt",
      DROP COLUMN IF EXISTS "normalizationDetails",
      DROP COLUMN IF EXISTS "normalizationVersion"
    `);
  }
}
