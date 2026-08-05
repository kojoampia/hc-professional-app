/**
 * The account as `GET /api/account` returns it.
 *
 * Copied from `web/src/main/webapp/app/core/auth/account.model.ts` (web commit
 * 48a12fc), converted from a class to an interface — nothing here constructs one
 * positionally, and an interface cannot be accidentally instantiated with the
 * eight arguments in the wrong order.
 */
export interface Account {
  activated: boolean;
  authorities: string[];
  email: string;
  firstName: string | null;
  langKey: string;
  lastName: string | null;
  login: string;
  imageUrl: string | null;
}
