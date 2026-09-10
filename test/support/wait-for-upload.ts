import type { App } from 'supertest/types';
import request from 'supertest';

/**
 * GOS-70 — image uploads are processed ASYNCHRONOUSLY (a BullMQ
 * `image-processing` job resizes + re-encodes the parked bytes and only
 * then promotes the WebP to the public key). Between the `PUT` and the
 * worker finishing, `GET /uploads/:key` returns 404. This helper polls the
 * public path until it 200s (or times out), so an e2e test can assert on
 * the processed result without a fixed sleep.
 *
 * PDF (and any non-image) uploads are written synchronously and are
 * available immediately — this helper still works for them (first poll
 * succeeds).
 */
export async function waitForUpload(
  httpServer: App,
  publicPath: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<request.Response> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const intervalMs = options?.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const response = await request(httpServer).get(publicPath);
    if (response.status === 200) {
      return response;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `waitForUpload: ${publicPath} never became available (last status ${response.status}) within ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
