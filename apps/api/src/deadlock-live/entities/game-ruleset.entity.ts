import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('game_rulesets')
@Index('idx_game_rulesets_ruleset_key', ['rulesetKey'], { unique: true })
@Index('idx_game_rulesets_client_version', ['clientVersion'])
export class GameRuleset {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 64 })
  rulesetKey!: string;

  @Column({ type: 'bigint', nullable: true })
  clientVersion!: number;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ type: 'varchar', length: 64, default: 'manual' })
  source!: string;

  @Column({ type: 'timestamptz', nullable: true })
  validFrom!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  validTo!: Date;

  @Column({ type: 'jsonb', nullable: true })
  rawMetadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
