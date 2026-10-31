import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  function make(dbUp: boolean, redisUp: boolean): { controller: HealthController; status: jest.Mock } {
    const dataSource = { query: dbUp ? jest.fn().mockResolvedValue([{ '?column?': 1 }]) : jest.fn().mockRejectedValue(new Error('db down')) };
    const redis = { ping: redisUp ? jest.fn().mockResolvedValue('PONG') : jest.fn().mockRejectedValue(new Error('redis down')) };
    return { controller: new HealthController(dataSource as unknown as DataSource, redis as unknown as Redis), status: jest.fn() };
  }
  const res = (status: jest.Mock): Response => ({ status }) as unknown as Response;

  it('база і Redis працюють: ok true і статус не чіпаємо (200)', async () => {
    const { controller, status } = make(true, true);
    await expect(controller.check(res(status))).resolves.toEqual({ ok: true, db: true, redis: true });
    expect(status).not.toHaveBeenCalled();
  });

  it('Redis лежить: ok false і 503', async () => {
    const { controller, status } = make(true, false);
    await expect(controller.check(res(status))).resolves.toEqual({ ok: false, db: true, redis: false });
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('база лежить: ok false і 503', async () => {
    const { controller, status } = make(false, true);
    await expect(controller.check(res(status))).resolves.toEqual({ ok: false, db: false, redis: true });
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
