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

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Column({ type: 'char', length: 64, nullable: true })
  payloadHash!: string;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  isCurrent!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  importedAt!: Date;
}
