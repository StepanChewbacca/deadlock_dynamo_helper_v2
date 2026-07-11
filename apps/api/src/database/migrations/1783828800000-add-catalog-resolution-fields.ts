import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCatalogResolutionFields1783828800000 implements MigrationInterface {
  name = 'AddCatalogResolutionFields1783828800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "item_catalog_items"
      ADD COLUMN "itemType" varchar(32) NOT NULL DEFAULT 'unknown',
      ADD COLUMN "isActiveItem" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      ADD COLUMN "resolvedRulesetId" integer,
      ADD COLUMN "resolvedCatalogVersionId" integer,
      ADD COLUMN "rulesetResolutionDetails" jsonb,
      ADD COLUMN "resolvedAt" timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      ADD CONSTRAINT "fk_raw_match_metadata_resolved_ruleset_id"
      FOREIGN KEY ("resolvedRulesetId")
      REFERENCES "game_rulesets"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      ADD CONSTRAINT "fk_raw_match_metadata_resolved_catalog_version_id"
      FOREIGN KEY ("resolvedCatalogVersionId")
      REFERENCES "item_catalog_versions"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_raw_match_metadata_resolved_ruleset_id"
      ON "raw_match_metadata" ("resolvedRulesetId")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_raw_match_metadata_resolved_catalog_version_id"
      ON "raw_match_metadata" ("resolvedCatalogVersionId")
    `);

    await queryRunner.query('UPDATE "item_catalog_versions" SET "isCurrent" = false');
    await queryRunner.query(`
      UPDATE "item_catalog_versions"
      SET "isCurrent" = true
      WHERE "id" = (
        SELECT "id"
        FROM "item_catalog_versions"
        ORDER BY "clientVersion" DESC
        LIMIT 1
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_item_catalog_versions_current"
      ON "item_catalog_versions" ("isCurrent")
      WHERE "isCurrent" = true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_item_catalog_versions_current"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_raw_match_metadata_resolved_catalog_version_id"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_raw_match_metadata_resolved_ruleset_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      DROP CONSTRAINT IF EXISTS "fk_raw_match_metadata_resolved_catalog_version_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      DROP CONSTRAINT IF EXISTS "fk_raw_match_metadata_resolved_ruleset_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "raw_match_metadata"
      DROP COLUMN IF EXISTS "resolvedAt",
      DROP COLUMN IF EXISTS "rulesetResolutionDetails",
      DROP COLUMN IF EXISTS "resolvedCatalogVersionId",
      DROP COLUMN IF EXISTS "resolvedRulesetId"
    `);
    await queryRunner.query(`
      ALTER TABLE "item_catalog_items"
      DROP COLUMN IF EXISTS "isActiveItem",
      DROP COLUMN IF EXISTS "itemType"
    `);
  }
}
