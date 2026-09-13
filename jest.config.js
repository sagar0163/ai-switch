/**
 * Jest configuration with coverage enforcement.
 * Coverage is collected for every file under src/ and thresholds are set so a
 * PR that drops meaningful coverage fails CI (target >= 70% lines per file).
 */
module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov', 'text-summary'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    },
    './src/**/*.js': {
      statements: 70,
      lines: 70
    }
  }
};