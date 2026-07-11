import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('crawler_runs')
export class CrawlerRun {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_crawler_runs_type')
  @Column({ type: 'varchar', length: 64 })
  crawlerType!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'int', default: 0 })
  targetMatches!: number;

  @Column({ type: 'int', default: 0 })
  discoveredMatches!: number;

  @Column({ type: 'int', default: 0 })
  processedMatches!: number;

  @Column({ type: 'bigint', nullable: true })
  currentMatchId!: number | null;

  @Column({ type: 'text', default: '' })
  statusMessage!: string;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn()
  startedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
