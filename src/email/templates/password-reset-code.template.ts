export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Mirrors `verification-code.template.ts`'s style exactly (no template
 * engine, plain string building) — the only differences are the copy
 * itself, since this code recovers a password rather than verifying an
 * email address.
 */
export function buildPasswordResetCodeEmail(
  code: string,
  ttlMinutes: number,
): RenderedEmail {
  const subject = 'Tu código para restablecer tu contraseña de GoService';
  const text =
    `Tu código para restablecer tu contraseña es: ${code}\n\n` +
    `Vence en ${ttlMinutes} minutos y es válido para un solo uso. ` +
    `Si no solicitaste este cambio, podés ignorar este mensaje: tu contraseña actual seguirá funcionando.`;
  const html =
    `<p>Tu código para restablecer tu contraseña es: <strong>${code}</strong></p>` +
    `<p>Vence en ${ttlMinutes} minutos y es válido para un solo uso. ` +
    `Si no solicitaste este cambio, podés ignorar este mensaje: tu contraseña actual seguirá funcionando.</p>`;
  return { subject, text, html };
}
