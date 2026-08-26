export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Mirrors `password-reset-code.template.ts`'s style exactly (no template
 * engine, plain string building) — the only real difference is that this
 * email carries a LINK (`inviteLink`, already fully composed by
 * `EmailQueueAdminInviteEmailSenderAdapter`), not a typed code: the invitee
 * isn't authenticated in any client yet, so there's no "enter this code"
 * screen for them to type it into.
 */
export function buildAdminInviteEmail(
  inviteLink: string,
  ttlHours: number,
): RenderedEmail {
  const subject = "You've been invited to the GoService admin panel";
  const text =
    `You've been invited as an administrator on the GoService admin panel.\n\n` +
    `Set your password here: ${inviteLink}\n\n` +
    `This link expires in ${ttlHours} hours and can only be used once. ` +
    `If you weren't expecting this invite, you can safely ignore this message.`;
  const html =
    `<p>You've been invited as an administrator on the GoService admin panel.</p>` +
    `<p><a href="${inviteLink}">Set your password</a></p>` +
    `<p>This link expires in ${ttlHours} hours and can only be used once. ` +
    `If you weren't expecting this invite, you can safely ignore this message.</p>`;
  return { subject, text, html };
}
