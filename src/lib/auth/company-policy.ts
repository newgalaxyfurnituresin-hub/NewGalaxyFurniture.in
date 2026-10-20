import type { AdminUser } from './users';
import { normalizeEmail } from './users';

export const COMPANY_ADMIN_EMAIL = 'newgalaxyfurnitures.in@gmail.com';

/** Uses trusted deployment configuration, never a caller-supplied Host or identity header. */
export function isCompanySite(siteUrl: string): boolean {
  try {
    return [
      'newgalaxyfurniture.in',
      'www.newgalaxyfurniture.in',
      'newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev',
    ].includes(new URL(siteUrl).hostname);
  } catch {
    return false;
  }
}

export function isCompanyAdministrator(user: Pick<AdminUser, 'email' | 'status'> | null): boolean {
  return (
    user !== null && user.status === 'ACTIVE' && normalizeEmail(user.email) === COMPANY_ADMIN_EMAIL
  );
}
