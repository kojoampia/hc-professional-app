import { TestBed } from '@angular/core/testing';

import { ApplicationConfigService } from './application-config.service';

describe('ApplicationConfigService', () => {
  let service: ApplicationConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ApplicationConfigService);
    service.setEndpointPrefix('https://example.test/');
  });

  it('builds gateway URLs', () => {
    expect(service.getEndpointFor('api/account')).toBe('https://example.test/api/account');
  });

  it('builds microservice URLs with the services prefix', () => {
    // Identical shape to web's, so API services copied from there work unmodified.
    expect(service.getEndpointFor('api/onboarding/duty-rosters/my', 'professionalservice')).toBe(
      'https://example.test/services/professionalservice/api/onboarding/duty-rosters/my',
    );
  });

  it('defaults to an ABSOLUTE base — a Capacitor app has no origin to be relative to', () => {
    const fresh = new ApplicationConfigService();
    expect(fresh.getEndpointPrefix()).toMatch(/^https?:\/\//);
  });

  it('keeps a trailing slash on the prefix, since paths concatenate directly', () => {
    const fresh = new ApplicationConfigService();
    expect(fresh.getEndpointPrefix().endsWith('/')).toBe(true);
    expect(fresh.getEndpointFor('api/x')).not.toContain('//api');
  });
});
