import { Argon2PasswordHasherAdapter } from './argon2-password-hasher.adapter';

describe('Argon2PasswordHasherAdapter', () => {
  const adapter = new Argon2PasswordHasherAdapter();

  it('hashes a password to an argon2id hash string', async () => {
    const hash = await adapter.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('round-trips: verify succeeds for the correct password', async () => {
    const hash = await adapter.hash('correct horse battery staple');
    await expect(
      adapter.verify(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
  });

  it('verify fails for an incorrect password', async () => {
    const hash = await adapter.hash('correct horse battery staple');
    await expect(adapter.verify(hash, 'wrong password')).resolves.toBe(false);
  });
});
