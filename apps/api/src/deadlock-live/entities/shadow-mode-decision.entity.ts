import { CreateDateColumn, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('shadow_mode_decisions')
export class ShadowModeDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  matchId!: string;

  @Column({ type: 'int' })
  gameTimeSec!: number;

  @Column({ type: 'int' })
  localHeroId!: number;

  @Column({ type: 'varchar', length: 64 })
  decision!: string;

  @Column({ type: 'int', nullable: true })
  recommendedItemId!: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recommendedItemName!: string | null;

  @Column({ type: 'varchar', length: 64 })
  currentArchetype!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nextCoreItemName!: string | null;

  @Column({ type: 'varchar', length: 32 })
  urgency!: string;

  @Column({ type: 'float' })
  confidence!: number;

  @Column({ type: 'text' })
  candidatesJson!: string;

  @Column({ type: 'text' })
  supportingEvidenceJson!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
