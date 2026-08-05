/**
 * Mirrors `web/jest.conf.js` where it makes sense, minus the JHipster/webpack
 * specifics (no `webpack/environment`, no `__RUM_ENDPOINT__` global).
 */
module.exports = {
  // THE Ionic + Jest trap. @ionic/angular, @stencil, ionicons and every @capacitor
  // package ship ESM only. Without whitelisting them here, the very first spec dies
  // with "SyntaxError: Cannot use import statement outside a module" and it looks
  // like a broken test rather than a transform config problem.
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@ionic|@stencil|ionicons|@capacitor|@aparajita|idb-keyval|dayjs/esm)'],
  resolver: 'jest-preset-angular/build/resolvers/ng-jest-resolver.js',
  roots: ['<rootDir>/src'],
  modulePaths: ['<rootDir>/src'],
  cacheDirectory: '<rootDir>/target/jest-cache',
  coverageDirectory: '<rootDir>/target/test-results/',
  testMatch: ['<rootDir>/src/app/**/*.spec.ts'],
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: '<rootDir>/target/test-results/', outputName: 'TESTS-results-jest.xml' }],
    ['jest-sonar', { outputDirectory: './target/test-results/jest', outputName: 'TESTS-results-sonar.xml' }],
  ],
  testEnvironmentOptions: {
    url: 'https://professional.abofonsa.com',
  },
};
