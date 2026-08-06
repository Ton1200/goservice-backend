export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildVerificationCodeEmail(
  code: string,
  ttlMinutes: number,
): RenderedEmail {
  const subject = 'Tu código de verificación de GoService';
  const text =
    `Tu código de verificación es: ${code}\n\n` +
    `Vence en ${ttlMinutes} minutos y es válido para un solo uso. ` +
    `Si no solicitaste este código, podés ignorar este mensaje.`;
  const html =
    `<p>Tu código de verificación es: <strong>${code}</strong></p>` +
    `<p>Vence en ${ttlMinutes} minutos y es válido para un solo uso. ` +
    `Si no solicitaste este código, podés ignorar este mensaje.</p>`;
  return { subject, text, html };
}
