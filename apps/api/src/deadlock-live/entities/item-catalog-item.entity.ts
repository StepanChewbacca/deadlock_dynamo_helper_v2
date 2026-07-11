import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ItemCatalogVersion } from './item-catalog-version.entity';

@Entity('item_catalog_items')
@Unique('uq_item_catalog_items_version_item', ['catalogVersionId', 'itemId'])
@Index('idx_item_catalog_items_item_id', ['itemId'])
export class ItemCatalogItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  catalogVersionId!: number;

  @ManyToOne(() => ItemCatalogVersion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'catalogVersionId' })
  catalogVersion!: ItemCatalogVersion;

  @Column({ type: 'bigint' })
  itemId!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  className!: string;

  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  itemType!: string;

  @Column({ type: 'varchar', length: 64 })
  slotType!: string;

  @Column({ type: 'int', default: 0 })
  cost!: number;

  @Column({ type: 'int', default: 0 })
  tier!: number;

  @Column({ type: 'boolean', default: false })
  shopable!: boolean;

  @Column({ type: 'boolean', default: false })
  disabled!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'boolean', default: false })
  isActiveItem!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  activationType!: string;

  @Column({ type: 'jsonb' })
  rawPayload!: Record<string, unknown>;
}
