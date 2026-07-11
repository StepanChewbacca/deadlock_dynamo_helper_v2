import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('heroes')
export class Hero {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_heroes_hero_id', { unique: true })
  @Column({ type: 'int' })
  heroId!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
