/** Unit-тести: без бази і без Redis. Файли *.spec.ts поруч із кодом. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
};
