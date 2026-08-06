import { buildVerificationCodeEmail } from './verification-code.template';

describe('buildVerificationCodeEmail', () => {
  it('includes the code and TTL in both the text and html bodies', () => {
    const result = buildVerificationCodeEmail('123456', 15);

    expect(result.text).toContain('123456');
    expect(result.text).toContain('15');
    expect(result.html).toContain('123456');
    expect(result.html).toContain('15');
  });

  it('has a stable, non-empty subject', () => {
    const result = buildVerificationCodeEmail('654321', 15);

    expect(result.subject.length).toBeGreaterThan(0);
  });
});
