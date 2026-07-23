import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreserveRecipeComponentMultiplicity1784937600000
  implements MigrationInterface
{
  name = 'PreserveRecipeComponentMultiplicity1784937600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "item_components"
      DROP CONSTRAINT IF EXISTS "uq_item_components_parent_component"
    `);
    await queryRunner.query(`
      ALTER TABLE "item_components"
      ADD CONSTRAINT "uq_item_components_parent_order"
      UNIQUE ("parentItemId", "componentOrder")
    `);

    await queryRunner.query(`
      ALTER TABLE "item_catalog_recipes"
      DROP CONSTRAINT IF EXISTS "uq_item_catalog_recipes_version_parent_component"
    `);
    await queryRunner.query(`
      ALTER TABLE "item_catalog_recipes"
      ADD CONSTRAINT "uq_item_catalog_recipes_version_parent_order"
      UNIQUE ("catalogVersionId", "parentItemId", "componentOrder")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "item_catalog_recipes"
      DROP CONSTRAINT IF EXISTS "uq_item_catalog_recipes_version_parent_order"
    `);
    await queryRunner.query(`
      ALTER TABLE "item_catalog_recipes"
      ADD CONSTRAINT "uq_item_catalog_recipes_version_parent_component"
      UNIQUE ("catalogVersionId", "parentItemId", "componentItemId")
    `);

    await queryRunner.query(`
      ALTER TABLE "item_components"
      DROP CONSTRAINT IF EXISTS "uq_item_components_parent_order"
    `);
    await queryRunner.query(`
      ALTER TABLE "item_components"
      ADD CONSTRAINT "uq_item_components_parent_component"
      UNIQUE ("parentItemId", "componentItemId")
    `);
  }
}
