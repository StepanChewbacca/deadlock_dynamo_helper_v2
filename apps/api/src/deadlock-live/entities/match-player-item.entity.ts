import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MatchPlayer } from './match-player.entity';

@Entity('match_player_items')
export class MatchPlayerItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_match_player_items_match_player_id')
  @Column({ type: 'int' })
  matchPlayerId!: number;

  @ManyToOne(() => MatchPlayer, (player) => player.itemPurchases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchPlayerId' })
  matchPlayer!: MatchPlayer;

  @Column({ type: 'bigint' })
  itemId!: number;

  @Column({ type: 'int', nullable: true })
  purchaseTimeS!: number | null;

  @Column({ type: 'int', nullable: true })
  soldTimeS!: number | null;

  @Column({ type: 'bigint', nullable: true })
  upgradeId!: number | null;

  @Column({ type: 'int', nullable: true })
  flags!: number | null;

  @Column({ type: 'bigint', nullable: true })
  imbuedAbilityId!: number | null;

  @Column({ type: 'bigint', nullable: true })
  upgradeInfo!: number | null;

  @Column({ type: 'int', nullable: true })
  slotOrder!: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
