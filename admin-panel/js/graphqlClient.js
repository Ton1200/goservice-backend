// GOS-30/31/32 — plain fetch()-based GraphQL client. No library, no
// generated types. The ONLY way any file in this directory reaches
// `/admin/graphql` — per the load-bearing rule in the platform-admin plan
// ("Load-bearing rule for this whole approach"), no file here may import or
// call backend services/Prisma directly.
import { getSessionToken, clearSession } from './session.js';

const ADMIN_UNAUTHENTICATED_CODE = 'ADMIN_UNAUTHENTICATED';

/**
 * Thrown for a network-level failure (fetch rejected, non-2xx HTTP status,
 * or a response body that isn't valid JSON) — distinct from a well-formed
 * GraphQL `{ errors: [...] }` response, which `graphqlRequest` returns
 * normally (never throws) so callers can inspect `extensions.code`
 * themselves. This mirrors the mobile app's Apollo `ErrorLink`
 * network-vs-GraphQL-error classification, hand-rolled since there's no
 * Apollo here.
 */
export class GraphQLNetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GraphQLNetworkError';
  }
}

/**
 * Posts `{ query, variables }` to this panel's own `graphql` endpoint,
 * attaching the in-memory bearer token (if any). Returns the parsed
 * `{ data, errors }` body on any well-formed GraphQL response — including
 * one that contains `errors` — so callers decide what to do with a
 * domain-level failure. Watches for
 * `errors[].extensions.code === 'ADMIN_UNAUTHENTICATED'`: on that specific
 * code, clears the in-memory session (the token is no longer valid — no
 * point holding onto it) before returning, so every subsequent request
 * already fails fast rather than repeating a doomed call. Callers (see
 * `settings.js`'s `showLoginView()`-on-401-style handling) still decide
 * whether to switch back to the login section — see `js/view.js`.
 *
 * Deliberately a RELATIVE path (`graphql`, no leading slash), not a
 * hardcoded `/admin/graphql` — this panel's mount path is configurable via
 * `ADMIN_PANEL_PATH` (see `src/config/configuration.ts` and
 * `src/app.module.ts`), so a hardcoded absolute `/admin/...` path would
 * silently 404 (falling through to the PUBLIC `/graphql` endpoint's
 * different, consumer-only schema) whenever an operator sets a non-default
 * value. A relative fetch resolves against the current document's own URL,
 * which is always `${adminPanelPath}/` (browsers/serve-static redirect a
 * bare `${adminPanelPath}` request to add the trailing slash before serving
 * `index.html`) — so `graphql` here always resolves to exactly
 * `${adminPanelPath}/graphql`, matching the backend route above, whatever
 * `adminPanelPath` is configured to be.
 */
export async function graphqlRequest(query, variables) {
  const token = getSessionToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch('graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new GraphQLNetworkError(
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (!response.ok && response.status !== 400) {
    // Apollo returns 400 for a well-formed GraphQL error response — only
    // treat OTHER non-2xx statuses (502, 504, etc.) as a network failure.
    throw new GraphQLNetworkError(
      `Unexpected server response (HTTP ${response.status}).`,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new GraphQLNetworkError('The server returned an invalid response.');
  }

  const hasAdminUnauthenticated = (body.errors ?? []).some(
    (error) => error?.extensions?.code === ADMIN_UNAUTHENTICATED_CODE,
  );
  if (hasAdminUnauthenticated) {
    clearSession();
  }

  return body;
}
