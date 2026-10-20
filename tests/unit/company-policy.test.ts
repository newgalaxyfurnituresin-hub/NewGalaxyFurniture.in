import { describe, expect, it } from 'vitest';
import {
  COMPANY_ADMIN_EMAIL,
  isCompanyAdministrator,
  isCompanySite,
} from '@/lib/auth/company-policy';

describe('company-only admin identity', () => {
  it('accepts only the exact approved active company mailbox', () => {
    expect(isCompanyAdministrator({ email: COMPANY_ADMIN_EMAIL, status: 'ACTIVE' })).toBe(true);
    expect(
      isCompanyAdministrator({ email: ' NEWGALAXYFURNITURES.IN@GMAIL.COM ', status: 'ACTIVE' }),
    ).toBe(true);
    for (const email of [
      'someone@gmail.com',
      'newgalaxyfurnitures.in+attacker@gmail.com',
      'newgalaxyfurnitures.in@gmail.com.attacker.invalid',
      'Manojmr1608@gmail.com',
      'newgalaxyfurnituresin@gmail.com',
    ]) {
      expect(isCompanyAdministrator({ email, status: 'ACTIVE' })).toBe(false);
    }
    expect(isCompanyAdministrator({ email: COMPANY_ADMIN_EMAIL, status: 'DISABLED' })).toBe(false);
    expect(isCompanyAdministrator(null)).toBe(false);
  });
  it('identifies all verified production addresses while keeping local test accounts isolated', () => {
    for (const host of [
      'newgalaxyfurniture.in',
      'www.newgalaxyfurniture.in',
      'newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev',
    ])
      expect(isCompanySite('https://' + host)).toBe(true);
    for (const url of [
      'http://127.0.0.1:8797',
      'https://newgalaxyfurniture.in.attacker.invalid',
      'bad url',
    ])
      expect(isCompanySite(url)).toBe(false);
  });
});
