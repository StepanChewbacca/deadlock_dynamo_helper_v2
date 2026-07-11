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

@Entity('item_catalog_recipes')
@Unique('uq_item_catalog_recipes_version_parent_component', [
  'catalogVersionId',
  'parentItemId',
  'componentItemId',
])
@Index('idx_item_catalog_recipes_parent_item_id', ['catalogVersionId', 'parentItemId'])
export class ItemCatalogRecipe {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  catalogVersionId!: number;

  @ManyToOne(() => ItemCatalogVersion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'catalogVersionId' })
  catalogVersion!: ItemCatalogVersion;

  @Column({ type: 'bigint' })
  parentItemId!: number;

  @Column({ type: 'bigint' })
  componentItemId!: number;

  @Column({ type: 'int', default: 0 })
  componentOrder!: number;
}
