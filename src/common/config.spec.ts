import { loadConfig } from './config';

describe('loadConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('у production з JWT_SECRET за замовчуванням сервіс не стартує', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    process.env.PAYMENT_WEBHOOK_SECRET = 'справжній-секрет-вебхука';
    expect(() => loadConfig()).toThrow('JWT_SECRET');
  });

  it('у production з PAYMENT_WEBHOOK_SECRET за замовчуванням сервіс не стартує', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'справжній-секрет-jwt';
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    expect(() => loadConfig()).toThrow('PAYMENT_WEBHOOK_SECRET');
  });

  it('у production із власними секретами конфіг читається', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'справжній-секрет-jwt';
    process.env.PAYMENT_WEBHOOK_SECRET = 'справжній-секрет-вебхука';
    expect(loadConfig().jwtSecret).toBe('справжній-секрет-jwt');
  });

  it('поза production секрети за замовчуванням дозволені', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    expect(loadConfig().jwtSecret).toBe('dev-secret-change-me');
  });

  it('S3_PRESIGN_EXPIRES_SEC: 300 за замовчуванням, інакше з env', () => {
    delete process.env.S3_PRESIGN_EXPIRES_SEC;
    expect(loadConfig().storage.presignExpiresSec).toBe(300);
    process.env.S3_PRESIGN_EXPIRES_SEC = '120';
    expect(loadConfig().storage.presignExpiresSec).toBe(120);
  });
});
