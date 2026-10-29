/** E2E-тести: потрібні справжні PostgreSQL і Redis (див. .env.example, змінні з префіксом TEST_). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  testTimeout: 60000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
};
