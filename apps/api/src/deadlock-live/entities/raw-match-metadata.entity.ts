import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { GameRuleset } from './game-ruleset.entity';
import { ItemCatalogVersion } from './item-catalog-version.entity';

export const RULESET_RESOLUTION_METHODS = [
  'OBSERVED',
  'DEMO_METADATA',
  'TIME_WINDOW',
  'UNKNOWN',
] as const;

export type RulesetResolutionMethod = (typeof RULESET_RESOLUTION_METHODS)[number];

@Entity('raw_match_metadata')
@Unique('uq_raw_match_metadata_match_payload', ['matchId', 'payloadHash'])
@Index('idx_raw_match_metadata_match_id', ['matchId'])
@Index('idx_raw_match_metadata_client_version', ['clientVersion'])
@Index('idx_raw_match_metadata_resolved_ruleset_id', ['resolvedRulesetId'])
@Index('idx_raw_match_metadata_resolved_catalog_version_id', ['resolvedCatalogVersionId'])
export class RawMatchMetadata {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'bigint' })
  matchId!: number;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Column({ type: 'varchar', length: 64 })
  payloadHash!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'int', nullable: true })
  metadataVersion!: number;

  @Column({ type: 'bigint', nullable: true })
  clientVersion!: number;

  @Column({ type: 'int', nullable: true })
  gameMode!: number;

  @Column({ type: 'int', nullable: true })
  matchMode!: number;

  @Column({ type: 'int', nullable: true })
  gameModeVersion!: number;

  @Column({ type: 'varchar', length: 32, default: 'UNKNOWN' })
  rulesetResolutionMethod!: RulesetResolutionMethod;

  @Column({ type: 'double precision', default: 0 })
  rulesetResolutionConfidence!: number;

  @Column({ type: 'int', nullable: true })
  resolvedRulesetId!: number;

  @ManyToOne(() => GameRuleset, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolvedRulesetId' })
  resolvedRuleset!: GameRuleset;

  @Column({ type: 'int', nullable: true })
  resolvedCatalogVersionId!: number;

  @ManyToOne(() => ItemCatalogVersion, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolvedCatalogVersionId' })
  resolvedCatalogVersion!: ItemCatalogVersion;

  @Column({ type: 'jsonb', nullable: true })
  rulesetResolutionDetails!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  processingVersion!: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastProcessedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  fetchedAt!: Date;
}
