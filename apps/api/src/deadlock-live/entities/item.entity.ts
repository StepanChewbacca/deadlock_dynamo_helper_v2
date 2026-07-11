import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('items')
export class Item {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_items_item_id', { unique: true })
  @Column({ type: 'bigint' })
  itemId!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  className!: string;

  @Column({ type: 'varchar', length: 64 })
  itemSlotType!: string;

  @Column({ type: 'int', default: 0 })
  cost!: number;

  @Column({ type: 'int', default: 0 })
  itemTier!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
