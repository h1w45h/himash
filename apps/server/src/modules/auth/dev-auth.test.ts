import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';

describe('локальный вход по нику', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it('включён без ключа Clerk и выключен в production', () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.DEV_AUTH;
    process.env.NODE_ENV = 'development';
    expect(AuthService.devAuthEnabled()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(AuthService.devAuthEnabled()).toBe(false);
  });
  it('с ключом Clerk выключен; явный флаг сильнее', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_1';
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_AUTH;
    expect(AuthService.devAuthEnabled()).toBe(false);
    process.env.DEV_AUTH = 'true';
    expect(AuthService.devAuthEnabled()).toBe(true);
    process.env.DEV_AUTH = 'false';
    delete process.env.CLERK_SECRET_KEY;
    expect(AuthService.devAuthEnabled()).toBe(false);
  });
});
