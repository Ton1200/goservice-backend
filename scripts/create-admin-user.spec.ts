import {
  CliArgumentError,
  describeExistingWithoutForce,
  describeRoleNotSeeded,
  normalizeRoleName,
  parseArgs,
  validatePasswordPolicy,
} from './create-admin-user';

// Unit tests for PURE LOGIC ONLY (argument parsing, role-name validation,
// password-policy check, and the "refuse without --force" message). This
// does NOT run the script end-to-end against a live database — actually
// running `create-admin-user.ts` (Prisma connection, AdminRole/AdminUser
// reads/writes, argon2 hashing) is a manual verification step, same
// honesty standard as `bootstrap-super-admin.ts`'s own (untested) `main()`.
describe('create-admin-user script — pure logic', () => {
  describe('normalizeRoleName', () => {
    it('accepts the 3 seeded role names case-insensitively', () => {
      expect(normalizeRoleName('SUPER_ADMIN')).toBe('SUPER_ADMIN');
      expect(normalizeRoleName('config_manager')).toBe('CONFIG_MANAGER');
      expect(normalizeRoleName('Support_Viewer')).toBe('SUPPORT_VIEWER');
    });

    it('trims surrounding whitespace before matching', () => {
      expect(normalizeRoleName('  SUPER_ADMIN  ')).toBe('SUPER_ADMIN');
    });

    it('returns null for an unknown role name', () => {
      expect(normalizeRoleName('OWNER')).toBeNull();
      expect(normalizeRoleName('')).toBeNull();
    });
  });

  describe('validatePasswordPolicy', () => {
    it('rejects a password shorter than 8 characters', () => {
      expect(validatePasswordPolicy('short1')).toMatch(/at least 8 characters/);
    });

    it('accepts a password of exactly 8 characters', () => {
      expect(validatePasswordPolicy('12345678')).toBeNull();
    });

    it('accepts a longer password', () => {
      expect(validatePasswordPolicy('Secret123!')).toBeNull();
    });
  });

  describe('parseArgs', () => {
    const validArgv = [
      '--email',
      'jane@goservice.com',
      '--password',
      'Secret123!',
      '--name',
      'Jane Doe',
      '--role',
      'CONFIG_MANAGER',
    ];

    it('parses a fully valid invocation', () => {
      expect(parseArgs(validArgv)).toEqual({
        email: 'jane@goservice.com',
        password: 'Secret123!',
        name: 'Jane Doe',
        role: 'CONFIG_MANAGER',
        force: false,
      });
    });

    it('parses --force as a boolean flag with no value', () => {
      expect(parseArgs([...validArgv, '--force'])).toEqual({
        email: 'jane@goservice.com',
        password: 'Secret123!',
        name: 'Jane Doe',
        role: 'CONFIG_MANAGER',
        force: true,
      });
    });

    it('defaults --force to false when not passed', () => {
      expect(parseArgs(validArgv).force).toBe(false);
    });

    it('normalizes --role case-insensitively', () => {
      const argv = [...validArgv];
      argv[argv.indexOf('CONFIG_MANAGER')] = 'config_manager';
      expect(parseArgs(argv).role).toBe('CONFIG_MANAGER');
    });

    function withoutFlag(flagName: string): string[] {
      const argv = [...validArgv];
      const flagIndex = argv.indexOf(`--${flagName}`);
      // Removes the flag AND its value (2 elements).
      argv.splice(flagIndex, 2);
      return argv;
    }

    it.each(['email', 'password', 'name', 'role'])(
      'throws CliArgumentError naming the missing --%s flag',
      (flagName) => {
        const argv = withoutFlag(flagName);
        expect(() => parseArgs(argv)).toThrow(CliArgumentError);
        expect(() => parseArgs(argv)).toThrow(new RegExp(`--${flagName}`));
      },
    );

    it('throws CliArgumentError listing all missing flags when none are passed', () => {
      expect(() => parseArgs([])).toThrow(CliArgumentError);
      expect(() => parseArgs([])).toThrow(
        /--email, --password, --name, --role/,
      );
    });

    it('throws CliArgumentError for an invalid --role value', () => {
      const argv = [...validArgv];
      argv[argv.indexOf('CONFIG_MANAGER')] = 'OWNER';
      expect(() => parseArgs(argv)).toThrow(CliArgumentError);
      expect(() => parseArgs(argv)).toThrow(/--role must be one of/);
    });

    it('throws CliArgumentError when a value-flag is missing its value', () => {
      expect(() => parseArgs(['--email'])).toThrow(CliArgumentError);
      expect(() => parseArgs(['--email'])).toThrow(/requires a value/);
    });

    it('treats blank/whitespace-only string values as missing', () => {
      const argv = [...validArgv];
      argv[argv.indexOf('Jane Doe')] = '   ';
      expect(() => parseArgs(argv)).toThrow(/--name/);
    });
  });

  describe('describeExistingWithoutForce', () => {
    it('mentions the email and --force', () => {
      const message = describeExistingWithoutForce('jane@goservice.com');
      expect(message).toContain('jane@goservice.com');
      expect(message).toContain('--force');
      expect(message).toMatch(/already exists/i);
    });
  });

  describe('describeRoleNotSeeded', () => {
    it('mentions the role and the bootstrap command', () => {
      const message = describeRoleNotSeeded('SUPER_ADMIN');
      expect(message).toContain('SUPER_ADMIN');
      expect(message).toContain('npm run admin:bootstrap');
    });
  });
});
