import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeduplicateItemCatalogContent1784088000000 implements MigrationInterface {
  name = 'DeduplicateItemCatalogContent1784088000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "item_catalog_versions"
      ADD COLUMN "contentCatalogVersionId" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "item_catalog_versions"
      ADD CONSTRAINT "fk_item_catalog_versions_content_catalog_version_id"
      FOREIGN KEY ("contentCatalogVersionId")
      REFERENCES "item_catalog_versions"("id")
      ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_item_catalog_versions_content_catalog_version_id"
      ON "item_catalog_versions" ("contentCatalogVersionId")
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          "id",
          MIN("id") OVER (PARTITION BY "payloadHash") AS "canonicalId"
        FROM "item_catalog_versions"
        WHERE "payloadHash" IS NOT NULL
      )
      UPDATE "item_catalog_versions" AS version
      SET "contentCatalogVersionId" = ranked."canonicalId"
      FROM ranked
      WHERE version."id" = ranked."id"
        AND ranked."id" <> ranked."canonicalId"
    `);

    await queryRunner.query(`
      DELETE FROM "item_catalog_recipes" AS recipe
      USING "item_catalog_versions" AS version
      WHERE recipe."catalogVersionId" = version."id"
        AND version."contentCatalogVersionId" IS NOT NULL
    `);

    await queryRunner.query(`
      DELETE FROM "item_catalog_items" AS item
      USING "item_catalog_versions" AS version
      WHERE item."catalogVersionId" = version."id"
        AND version."contentCatalogVersionId" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "item_catalog_items" (
        "catalogVersionId",
        "itemId",
        "name",
        "className",
        "itemType",
        "slotType",
        "cost",
        "tier",
        "shopable",
        "disabled",
        "active",
        "isActiveItem",
        "activationType",
        "rawPayload"
      )
      SELECT
        alias."id",
        source."itemId",
        source."name",
        source."className",
        source."itemType",
        source."slotType",
        source."cost",
        source."tier",
        source."shopable",
        source."disabled",
        source."active",
        source."isActiveItem",
        source."activationType",
        source."rawPayload"
      FROM "item_catalog_versions" AS alias
      JOIN "item_catalog_items" AS source
        ON source."catalogVersionId" = alias."contentCatalogVersionId"
      WHERE alias."contentCatalogVersionId" IS NOT NULL
      ON CONFLICT ("catalogVersionId", "itemId") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "item_catalog_recipes" (
        "catalogVersionId",
        "parentItemId",
        "componentItemId",
        "componentOrder"
      )
      SELECT
        alias."id",
        source."parentItemId",
        source."componentItemId",
        source."componentOrder"
      FROM "item_catalog_versions" AS alias
      JOIN "item_catalog_recipes" AS source
        ON source."catalogVersionId" = alias."contentCatalogVersionId"
      WHERE alias."contentCatalogVersionId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_item_catalog_versions_content_catalog_version_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "item_catalog_versions"
      DROP CONSTRAINT IF EXISTS "fk_item_catalog_versions_content_catalog_version_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "item_catalog_versions"
      DROP COLUMN IF EXISTS "contentCatalogVersionId"
    `);
  }
}
