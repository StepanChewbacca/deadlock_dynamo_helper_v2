import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchemaAndRawMetadata1783785600000 implements MigrationInterface {
  name = 'InitialSchemaAndRawMetadata1783785600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(`
      CREATE TABLE "matches" (
        "matchId" bigint NOT NULL,
        "startTime" timestamp NOT NULL,
        "durationS" integer,
        "averageBadge" integer,
        "winningTeam" integer,
        "crawledAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_matches_match_id" PRIMARY KEY ("matchId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "match_players" (
        "id" SERIAL NOT NULL,
        "matchId" bigint NOT NULL,
        "heroId" integer NOT NULL,
        "team" integer NOT NULL,
        "won" boolean NOT NULL,
        "kills" integer,
        "deaths" integer,
        "assists" integer,
        "netWorth" integer,
        "crawledAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_match_players_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_match_players_match_hero" UNIQUE ("matchId", "heroId"),
        CONSTRAINT "fk_match_players_match_id" FOREIGN KEY ("matchId")
          REFERENCES "matches"("matchId") ON DELETE CASCADE
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_match_players_hero_id" ON "match_players" ("heroId")');

    await queryRunner.query(`
      CREATE TABLE "match_player_items" (
        "id" SERIAL NOT NULL,
        "matchPlayerId" integer NOT NULL,
        "itemId" bigint NOT NULL,
        "purchaseTimeS" integer,
        "soldTimeS" integer,
        "upgradeId" bigint,
        "flags" integer,
        "imbuedAbilityId" bigint,
        "upgradeInfo" bigint,
        "slotOrder" integer,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_match_player_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_match_player_items_match_player_id" FOREIGN KEY ("matchPlayerId")
          REFERENCES "match_players"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_match_player_items_match_player_id" ON "match_player_items" ("matchPlayerId")',
    );

    await queryRunner.query(`
      CREATE TABLE "match_player_skill_upgrades" (
        "id" SERIAL NOT NULL,
        "matchPlayerId" integer NOT NULL,
        "abilityId" bigint NOT NULL,
        "upgradeOrder" integer NOT NULL,
        "upgradeTimeS" integer,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_match_player_skill_upgrades_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_match_player_skill_upgrades_match_player_id" FOREIGN KEY ("matchPlayerId")
          REFERENCES "match_players"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_match_player_skill_upgrades_match_player_id" ON "match_player_skill_upgrades" ("matchPlayerId")',
    );

    await queryRunner.query(`
      CREATE TABLE "heroes" (
        "id" SERIAL NOT NULL,
        "heroId" integer NOT NULL,
        "name" varchar(255) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_heroes_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "idx_heroes_hero_id" ON "heroes" ("heroId")');

    await queryRunner.query(`
      CREATE TABLE "items" (
        "id" SERIAL NOT NULL,
        "itemId" bigint NOT NULL,
        "name" varchar(255) NOT NULL,
        "className" varchar(255) NOT NULL,
        "itemSlotType" varchar(64) NOT NULL,
        "cost" integer NOT NULL DEFAULT 0,
        "itemTier" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_items_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "idx_items_item_id" ON "items" ("itemId")');

    await queryRunner.query(`
      CREATE TABLE "item_components" (
        "id" SERIAL NOT NULL,
        "parentItemId" bigint NOT NULL,
        "componentItemId" bigint NOT NULL,
        "componentOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_item_components_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_item_components_parent_component" UNIQUE ("parentItemId", "componentItemId")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_item_components_parent_item_id" ON "item_components" ("parentItemId")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_item_components_component_item_id" ON "item_components" ("componentItemId")',
    );

    await queryRunner.query(`
      CREATE TABLE "crawler_runs" (
        "id" SERIAL NOT NULL,
        "crawlerType" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL,
        "targetMatches" integer NOT NULL DEFAULT 0,
        "discoveredMatches" integer NOT NULL DEFAULT 0,
        "processedMatches" integer NOT NULL DEFAULT 0,
        "currentMatchId" bigint,
        "statusMessage" text NOT NULL DEFAULT '',
        "lastError" text,
        "finishedAt" timestamp,
        "startedAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crawler_runs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_crawler_runs_type" ON "crawler_runs" ("crawlerType")');

    await queryRunner.query(`
      CREATE TABLE "crawler_state" (
        "id" SERIAL NOT NULL,
        "crawlerType" varchar(64) NOT NULL,
        "isCrawling" boolean NOT NULL DEFAULT false,
        "current" integer NOT NULL DEFAULT 0,
        "total" integer NOT NULL DEFAULT 0,
        "currentMatchId" bigint,
        "status" text NOT NULL DEFAULT 'Idle',
        "lastSuccessAt" timestamp,
        "lastError" text,
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crawler_state_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_crawler_state_type" ON "crawler_state" ("crawlerType")',
    );

    await queryRunner.query(`
      CREATE TABLE "shadow_mode_decisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "matchId" varchar(255) NOT NULL,
        "gameTimeSec" integer NOT NULL,
        "localHeroId" integer NOT NULL,
        "decision" varchar(64) NOT NULL,
        "recommendedItemId" integer,
        "recommendedItemName" varchar(255),
        "currentArchetype" varchar(64) NOT NULL,
        "nextCoreItemName" varchar(255),
        "urgency" varchar(32) NOT NULL,
        "confidence" double precision NOT NULL,
        "candidatesJson" text NOT NULL,
        "supportingEvidenceJson" text NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_shadow_mode_decisions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "game_rulesets" (
        "id" SERIAL NOT NULL,
        "rulesetKey" varchar(64) NOT NULL,
        "clientVersion" bigint,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "source" varchar(64) NOT NULL DEFAULT 'manual',
        "validFrom" timestamptz,
        "validTo" timestamptz,
        "rawMetadata" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_game_rulesets_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_game_rulesets_ruleset_key" ON "game_rulesets" ("rulesetKey")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_game_rulesets_client_version" ON "game_rulesets" ("clientVersion")',
    );

    await queryRunner.query(`
      CREATE TABLE "item_catalog_versions" (
        "id" SERIAL NOT NULL,
        "clientVersion" bigint NOT NULL,
        "rulesetId" integer,
        "source" varchar(64) NOT NULL,
        "payloadHash" char(64),
        "rawPayload" jsonb,
        "isCurrent" boolean NOT NULL DEFAULT false,
        "importedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_item_catalog_versions_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_item_catalog_versions_ruleset_id" FOREIGN KEY ("rulesetId")
          REFERENCES "game_rulesets"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_item_catalog_versions_client_version" ON "item_catalog_versions" ("clientVersion")',
    );

    await queryRunner.query(`
      CREATE TABLE "item_catalog_items" (
        "id" SERIAL NOT NULL,
        "catalogVersionId" integer NOT NULL,
        "itemId" bigint NOT NULL,
        "name" varchar(255) NOT NULL,
        "className" varchar(255) NOT NULL,
        "slotType" varchar(64) NOT NULL,
        "cost" integer NOT NULL DEFAULT 0,
        "tier" integer NOT NULL DEFAULT 0,
        "shopable" boolean NOT NULL DEFAULT false,
        "disabled" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "activationType" varchar(64),
        "rawPayload" jsonb NOT NULL,
        CONSTRAINT "pk_item_catalog_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_item_catalog_items_version_item" UNIQUE ("catalogVersionId", "itemId"),
        CONSTRAINT "fk_item_catalog_items_catalog_version_id" FOREIGN KEY ("catalogVersionId")
          REFERENCES "item_catalog_versions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_item_catalog_items_item_id" ON "item_catalog_items" ("itemId")',
    );

    await queryRunner.query(`
      CREATE TABLE "item_catalog_recipes" (
        "id" SERIAL NOT NULL,
        "catalogVersionId" integer NOT NULL,
        "parentItemId" bigint NOT NULL,
        "componentItemId" bigint NOT NULL,
        "componentOrder" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_item_catalog_recipes_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_item_catalog_recipes_version_parent_component"
          UNIQUE ("catalogVersionId", "parentItemId", "componentItemId"),
        CONSTRAINT "fk_item_catalog_recipes_catalog_version_id" FOREIGN KEY ("catalogVersionId")
          REFERENCES "item_catalog_versions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_item_catalog_recipes_parent_item_id" ON "item_catalog_recipes" ("catalogVersionId", "parentItemId")',
    );

    await queryRunner.query(`
      CREATE TABLE "raw_match_metadata" (
        "id" SERIAL NOT NULL,
        "matchId" bigint NOT NULL,
        "source" varchar(64) NOT NULL,
        "payloadHash" char(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "metadataVersion" integer,
        "clientVersion" bigint,
        "gameMode" integer,
        "matchMode" integer,
        "gameModeVersion" integer,
        "rulesetResolutionMethod" varchar(32) NOT NULL DEFAULT 'UNKNOWN',
        "rulesetResolutionConfidence" double precision NOT NULL DEFAULT 0,
        "processingVersion" varchar(64),
        "lastProcessedAt" timestamptz,
        "fetchedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_raw_match_metadata_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_raw_match_metadata_match_payload" UNIQUE ("matchId", "payloadHash")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_raw_match_metadata_match_id" ON "raw_match_metadata" ("matchId")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_raw_match_metadata_client_version" ON "raw_match_metadata" ("clientVersion")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "raw_match_metadata"');
    await queryRunner.query('DROP TABLE IF EXISTS "item_catalog_recipes"');
    await queryRunner.query('DROP TABLE IF EXISTS "item_catalog_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "item_catalog_versions"');
    await queryRunner.query('DROP TABLE IF EXISTS "game_rulesets"');
    await queryRunner.query('DROP TABLE IF EXISTS "shadow_mode_decisions"');
    await queryRunner.query('DROP TABLE IF EXISTS "crawler_state"');
    await queryRunner.query('DROP TABLE IF EXISTS "crawler_runs"');
    await queryRunner.query('DROP TABLE IF EXISTS "item_components"');
    await queryRunner.query('DROP TABLE IF EXISTS "items"');
    await queryRunner.query('DROP TABLE IF EXISTS "heroes"');
    await queryRunner.query('DROP TABLE IF EXISTS "match_player_skill_upgrades"');
    await queryRunner.query('DROP TABLE IF EXISTS "match_player_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "match_players"');
    await queryRunner.query('DROP TABLE IF EXISTS "matches"');
  }
}
