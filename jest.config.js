/**
 * Mirrors `web/jest.conf.js` where it makes sense, minus the JHipster/webpack
 * specifics (no `webpack/environment`, no `__RUM_ENDPOINT__` global).
 */
module.exports = {
  // THE Ionic + Jest trap. @ionic/angular, @stencil, ionicons and every @capacitor
  // package ship ESM only. Without whitelisting them here, the very first spec dies
  // with "SyntaxError: Cannot use import statement outside a module" and it looks
  // like a broken test rather than a transform config problem.
  // `@angular/common/locales/*` is ESM and ships no CommonJS build, so importing one to register
  // locale data fails here with "Jest encountered an unexpected token" pointing at de.js — which
  // reads as a broken spec rather than a transform-config gap. It is listed for the same reason as
  // the Ionic packages beside it.
  transformIgnorePatterns: [
    'node_modules/(?!.*\\.mjs$|@angular/common/locales|@ionic|@stencil|ionicons|@capacitor|@aparajita|idb-keyval|dayjs/esm)',
  ],
  resolver: 'jest-preset-angular/build/resolvers/ng-jest-resolver.js',
  // THE SECOND Ionic + Jest trap, hit by the first spec that renders an Ionic component rather
  // than testing a store. `ionicons` declares ./components/* with an "import" condition only, so
  // Jest's CommonJS resolution asks for "require", finds nothing, and reports
  // "Cannot find module 'ionicons/components/ion-icon.js'" — pointing at @ionic/angular, which is
  // not where the problem is. The files exist; only the exports map is unreachable from CJS, so
  // map straight at them.
  moduleNameMapper: {
    '^ionicons/components/(.*)$': '<rootDir>/node_modules/ionicons/components/$1',
    '^ionicons/icons$': '<rootDir>/node_modules/ionicons/icons/index.js',
  },
  // jsdom has no crypto.subtle; src/setup-jest.ts installs Node's real WebCrypto so
  // the offline-cache encryption specs test actual AES-GCM rather than a mock.
  setupFilesAfterEnv: ['<rootDir>/src/setup-jest.ts'],
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
