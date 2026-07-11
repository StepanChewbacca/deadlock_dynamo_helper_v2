import { Entity, PrimaryColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { MatchPlayer } from './match-player.entity';

@Entity('matches')
export class Match {
  @PrimaryColumn({ type: 'bigint' })
  matchId!: number;

  @Column({ type: 'timestamp' })
  startTime!: Date;

  @Column({ type: 'int', nullable: true })
  durationS!: number;

  @Column({ type: 'int', nullable: true })
  averageBadge!: number;

  @Column({ type: 'int', nullable: true })
  winningTeam!: number;

  @CreateDateColumn()
  crawledAt!: Date;

  @OneToMany(() => MatchPlayer, (mp) => mp.match)
  players!: MatchPlayer[];
}
