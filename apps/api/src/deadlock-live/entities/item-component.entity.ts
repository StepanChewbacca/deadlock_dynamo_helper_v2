import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('item_components')
@Unique('uq_item_components_parent_order', [
  'parentItemId',
  'componentOrder',
])
export class ItemComponent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_item_components_parent_item_id')
  @Column({ type: 'bigint' })
  parentItemId!: number;

  @Index('idx_item_components_component_item_id')
  @Column({ type: 'bigint' })
  componentItemId!: number;

  @Column({ type: 'int', default: 0 })
  componentOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
