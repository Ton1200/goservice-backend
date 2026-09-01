import { renderEmailTemplate, substitute } from './render-email-template.util';

describe('renderEmailTemplate', () => {
  const row = {
    key: 'verification_code',
    subject: 'Hi {{firstName}}, your code',
    htmlBody: '<p>{{greeting}}</p><p>Code: {{code}}</p><p>{{unknown}}</p>',
    textBody: 'Greeting: {{greeting}}\nCode: {{code}}\nUnknown: {{unknown}}',
  };

  it('HTML-escapes a substituted value when rendering into htmlBody', () => {
    const result = renderEmailTemplate(row, {
      firstName: 'Jane',
      greeting: '<script>alert(1)</script>',
      code: '123456',
    });

    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });

  it('does NOT HTML-escape the same raw value when substituted into textBody/subject', () => {
    const result = renderEmailTemplate(row, {
      firstName: '<b>Jane</b>',
      greeting: '<script>alert(1)</script>',
      code: '123456',
    });

    expect(result.text).toContain('<script>alert(1)</script>');
    expect(result.subject).toContain('<b>Jane</b>');
  });

  it('leaves an unrecognized {{token}} literal in the output, not blanked', () => {
    const result = renderEmailTemplate(row, {
      firstName: 'Jane',
      greeting: 'Hola Jane,',
      code: '123456',
    });

    expect(result.html).toContain('{{unknown}}');
    expect(result.text).toContain('{{unknown}}');
  });
});

// Shared header/footer follow-up (2026-08-25) — `substitute` is now exported
// directly (see its own header comment) so `EmailTemplateRenderer` can reuse
// it against `EmailLayout`'s `headerHtml`/`footerHtml`/`headerText`/
// `footerText`. Direct coverage here, independent of `renderEmailTemplate`'s
// own `EmailTemplateRow`-shaped tests above.
describe('substitute', () => {
  it('HTML-escapes a substituted value when escapeValues is true', () => {
    const result = substitute(
      '<p>{{greeting}}</p>',
      { greeting: '<script>alert(1)</script>' },
      true,
    );

    expect(result).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('does NOT HTML-escape a substituted value when escapeValues is false', () => {
    const result = substitute(
      'Greeting: {{greeting}}',
      { greeting: '<b>Jane</b>' },
      false,
    );

    expect(result).toBe('Greeting: <b>Jane</b>');
  });

  it('leaves an unrecognized {{token}} literal in the output', () => {
    const result = substitute('{{known}} {{unknown}}', { known: 'x' }, false);

    expect(result).toBe('x {{unknown}}');
  });
});
