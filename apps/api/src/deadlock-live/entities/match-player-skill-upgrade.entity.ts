import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MatchPlayer } from './match-player.entity';

@Entity('match_player_skill_upgrades')
export class MatchPlayerSkillUpgrade {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_match_player_skill_upgrades_match_player_id')
  @Column({ type: 'int' })
  matchPlayerId!: number;

  @ManyToOne(() => MatchPlayer, (player) => player.skillUpgrades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchPlayerId' })
  matchPlayer!: MatchPlayer;

  @Column({ type: 'bigint' })
  abilityId!: number;

  @Column({ type: 'int' })
  upgradeOrder!: number;

  @Column({ type: 'int', nullable: true })
  upgradeTimeS!: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
