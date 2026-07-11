import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DATABASE_ENTITIES } from './database-entities';

export const databaseOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'deadlock_builds',
  entities: DATABASE_ENTITIES,
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
};

export const AppDataSource = new DataSource(databaseOptions);

export default AppDataSource;
