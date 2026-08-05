import { Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';

/**
 * Builds API URLs.
 *
 * Adapted from `web/src/main/webapp/app/core/config/application-config.service.ts`
 * (web commit 48a12fc). `getEndpointFor` keeps the identical shape so every API
 * service copied from there works unmodified.
 *
 * The one real difference: web defaults `endpointPrefix` to `''` because the SPA
 * is served from the same origin as the API. **A Capacitor app has no origin to
 * be relative to** — its document is `capacitor://localhost` — so the prefix is
 * an absolute base URL from `src/environments/`, and it must end with a slash
 * because this concatenates directly onto it.
 */
@Injectable({ providedIn: 'root' })
export class ApplicationConfigService {
  private endpointPrefix = environment.apiBaseUrl;

  /** Test seam. Production reads the environment. */
  setEndpointPrefix(endpointPrefix: string): void {
    this.endpointPrefix = endpointPrefix;
  }

  getEndpointPrefix(): string {
    return this.endpointPrefix;
  }

  getEndpointFor(api: string, microservice?: string): string {
    if (microservice) {
      return `${this.endpointPrefix}services/${microservice}/${api}`;
    }
    return `${this.endpointPrefix}${api}`;
  }
}
