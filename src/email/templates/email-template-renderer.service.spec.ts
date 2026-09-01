import { EmailTemplatePort } from '../../platform-admin/email-templates/ports/email-template.port';
import { EmailLayoutPort } from '../../platform-admin/email-templates/ports/email-layout.port';
import { EmailTemplateRenderer } from './email-template-renderer.service';

describe('EmailTemplateRenderer', () => {
  const templateRow = {
    subject: 'Tu código: {{code}}',
    htmlBody: '<p>{{greeting}} Code: {{code}}</p>',
    textBody: '{{greeting}} Code: {{code}}',
  };

  const layoutRow = {
    headerHtml: '<header>{{greeting}}</header>',
    footerHtml: '<footer>Footer</footer>',
    headerText: 'Header: {{greeting}}\n',
    footerText: '\nFooter text',
    logoUrl: null as string | null,
  };

  function makeRenderer(options?: {
    template?: typeof templateRow | null;
    layout?: typeof layoutRow | null;
  }) {
    const getByKey = jest
      .fn()
      .mockResolvedValue(
        options?.template === undefined ? templateRow : options.template,
      );
    const emailTemplatePort = { getByKey } as unknown as EmailTemplatePort;

    const getLayout = jest
      .fn()
      .mockResolvedValue(
        options?.layout === undefined ? layoutRow : options.layout,
      );
    const emailLayoutPort = { getLayout } as unknown as EmailLayoutPort;

    const renderer = new EmailTemplateRenderer(
      emailTemplatePort,
      emailLayoutPort,
    );

    return { renderer, getByKey, getLayout };
  }

  it('composes headerHtml + template body html + footerHtml, in that order', async () => {
    const { renderer } = makeRenderer();

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Jane,',
      code: '123456',
    });

    expect(result.html).toBe(
      '<header>Hola Jane,</header><p>Hola Jane, Code: 123456</p><footer>Footer</footer>',
    );
  });

  it('composes headerText + template body text + footerText, in that order', async () => {
    const { renderer } = makeRenderer();

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Jane,',
      code: '123456',
    });

    expect(result.text).toBe(
      'Header: Hola Jane,\nHola Jane, Code: 123456\nFooter text',
    );
  });

  it('substitutes {{greeting}} consistently across header, body, and footer', async () => {
    const { renderer } = makeRenderer();

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Juana,',
      code: '999999',
    });

    expect(result.html).toContain('<header>Hola Juana,</header>');
    expect(result.text).toContain('Header: Hola Juana,');
  });

  it('never applies the layout to the subject', async () => {
    const { renderer } = makeRenderer();

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Jane,',
      code: '123456',
    });

    expect(result.subject).toBe('Tu código: 123456');
  });

  it('HTML-escapes a variable substituted into headerHtml/footerHtml, but not headerText/footerText', async () => {
    const { renderer } = makeRenderer();

    const result = await renderer.render('verification_code', {
      greeting: '<script>alert(1)</script>',
      code: '123456',
    });

    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.text).toContain('<script>alert(1)</script>');
  });

  it('throws EMAIL_TEMPLATE_NOT_CONFIGURED when no template row exists, without reading the layout', async () => {
    const { renderer, getLayout } = makeRenderer({ template: null });

    await expect(
      renderer.render('verification_code', { greeting: 'Hola,', code: '1' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TEMPLATE_NOT_CONFIGURED' });
    expect(getLayout).not.toHaveBeenCalled();
  });

  it('throws EMAIL_LAYOUT_NOT_CONFIGURED when the template exists but no layout row exists', async () => {
    const { renderer } = makeRenderer({ layout: null });

    await expect(
      renderer.render('verification_code', { greeting: 'Hola,', code: '1' }),
    ).rejects.toMatchObject({ code: 'EMAIL_LAYOUT_NOT_CONFIGURED' });
  });

  it('substitutes {{logoUrl}} in headerHtml/footerHtml with layout.logoUrl when set', async () => {
    const { renderer } = makeRenderer({
      layout: {
        ...layoutRow,
        headerHtml: '<header><img src="{{logoUrl}}"></header>',
        footerHtml: '<footer><img src="{{logoUrl}}"></footer>',
        logoUrl: 'http://localhost:3000/uploads/abc123.png',
      },
    });

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Jane,',
      code: '123456',
    });

    expect(result.html).toContain(
      '<img src="http://localhost:3000/uploads/abc123.png">',
    );
  });

  it('renders {{logoUrl}} as an empty string (not the literal token) when layout.logoUrl is null', async () => {
    const { renderer } = makeRenderer({
      layout: {
        ...layoutRow,
        headerHtml: '<header><img src="{{logoUrl}}"></header>',
        logoUrl: null,
      },
    });

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Jane,',
      code: '123456',
    });

    expect(result.html).toContain('<img src="">');
    expect(result.html).not.toContain('{{logoUrl}}');
  });

  it('never leaks {{logoUrl}} into the template body variables (body has no logoUrl token to substitute anyway)', async () => {
    const { renderer } = makeRenderer({
      layout: { ...layoutRow, logoUrl: 'http://localhost:3000/uploads/x.png' },
    });

    const result = await renderer.render('verification_code', {
      greeting: 'Hola Jane,',
      code: '123456',
    });

    // The template body itself never references {{logoUrl}} (see
    // templateRow above) — this just documents that adding logoUrl to the
    // layout-only variables map doesn't alter body rendering at all.
    expect(result.html).toBe(
      '<header>Hola Jane,</header><p>Hola Jane, Code: 123456</p><footer>Footer</footer>',
    );
  });
});
