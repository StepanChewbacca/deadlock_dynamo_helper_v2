import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GameRuleset } from './game-ruleset.entity';

@Entity('item_catalog_versions')
@Index('idx_item_catalog_versions_client_version', ['clientVersion'], { unique: true })
@Index('idx_item_catalog_versions_content_catalog_version_id', ['contentCatalogVersionId'])
export class ItemCatalogVersion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'bigint' })
  clientVersion!: number;

  @Column({ type: 'int', nullable: true })
  rulesetId!: number;

  @ManyToOne(() => GameRuleset, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rulesetId' })
  ruleset!: GameRuleset;

  @Column({ type: 'int', nullable: true })
  contentCatalogVersionId!: number;

  @ManyToOne(() => ItemCatalogVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'contentCatalogVersionId' })
  contentCatalogVersion!: ItemCatalogVersion;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  payloadHash!: string;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  isCurrent!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  importedAt!: Date;
}

export function getCatalogContentVersionId(
  catalog: Pick<ItemCatalogVersion, 'id' | 'contentCatalogVersionId'>,
): number {
  return catalog.contentCatalogVersionId
    ? Number(catalog.contentCatalogVersionId)
    : Number(catalog.id);
}
