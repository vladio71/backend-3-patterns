// DataSource для CLI міграцій (npm run migration:run) і для тестів. Додаток використовує ті самі опції через TypeOrmModule.
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { Init1730000000000 } from './migrations/1730000000000-Init';
import { AddOrderItemsProductIdx1730000001000 } from './migrations/1730000001000-AddOrderItemsProductIdx';
import { loadConfig } from './common/config';

export const MIGRATIONS = [Init1730000000000, AddOrderItemsProductIdx1730000001000];

export function dataSourceOptions(): DataSourceOptions {
  const config = loadConfig();
  return {
    type: 'postgres',
    host: config.db.host,
    port: config.db.port,
    username: config.db.user,
    password: config.db.password,
    database: config.db.name,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    logging: config.db.logging ? ['query'] : false,
  };
}

export default new DataSource(dataSourceOptions());
