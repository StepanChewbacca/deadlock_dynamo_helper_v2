import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('crawler_state')
export class CrawlerState {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_crawler_state_type', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  crawlerType!: string;

  @Column({ type: 'boolean', default: false })
  isCrawling!: boolean;

  @Column({ type: 'int', default: 0 })
  current!: number;

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ type: 'bigint', nullable: true })
  currentMatchId!: number | null;

  @Column({ type: 'text', default: 'Idle' })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
