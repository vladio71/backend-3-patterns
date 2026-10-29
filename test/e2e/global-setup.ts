// Один раз перед усіма e2e: прогнати міграції на тестовій базі і очистити черги в Redis.
import 'reflect-metadata';
import './env';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { dataSourceOptions } from '../../src/data-source';

export default async function globalSetup(): Promise<void> {
  const ds = new DataSource({ ...dataSourceOptions(), logging: false });
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();

  const redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), db: Number(process.env.REDIS_DB) });
  await redis.flushdb();
  await redis.quit();
}
