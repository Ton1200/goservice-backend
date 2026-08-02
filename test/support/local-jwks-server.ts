import { createServer, Server } from 'http';
import type { AddressInfo } from 'net';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';

/**
 * Serves a real, locally-generated JWKS over HTTP so `socialLogin` e2e
 * tests can validate a synthetic RS256-signed JWT end-to-end through the
 * real `JoseSocialIdentityValidationAdapter` (`createRemoteJWKSet` +
 * `jwtVerify`) — WITHOUT ever calling real Google/Apple infrastructure,
 * which is impossible to obtain valid tokens for in this environment. This
 * is an explicit substitute, not a real-provider test — see the GOS-22
 * plan's Verification section.
 */
export class LocalJwksServer {
  private server?: Server;
  private privateKey?: KeyLike;
  private readonly keyId = 'test-key-1';

  async start(): Promise<{ jwksUri: string }> {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    const jwk = await exportJWK(publicKey);

    this.server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          keys: [{ ...jwk, kid: this.keyId, alg: 'RS256', use: 'sig' }],
        }),
      );
    });

    await new Promise<void>((resolve) => this.server!.listen(0, resolve));
    const { port } = this.server.address() as AddressInfo;
    return { jwksUri: `http://127.0.0.1:${port}/jwks` };
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    // `closeAllConnections` forcibly drops any lingering keep-alive
    // sockets (e.g. from jose's remote-JWKS HTTP client) that would
    // otherwise keep `server.close()`'s callback from ever firing.
    this.server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** Signs a synthetic identity token as if issued by `issuer` for `audience`. */
  async signToken(claims: {
    issuer: string;
    audience: string;
    subject: string;
    email: string;
    firstName?: string;
    lastName?: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    if (!this.privateKey) {
      throw new Error(
        'LocalJwksServer.start() must be called before signToken().',
      );
    }
    return new SignJWT({
      email: claims.email,
      given_name: claims.firstName,
      family_name: claims.lastName,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId })
      .setIssuer(claims.issuer)
      .setAudience(claims.audience)
      .setSubject(claims.subject)
      .setIssuedAt()
      .setExpirationTime(`${claims.expiresInSeconds ?? 300}s`)
      .sign(this.privateKey);
  }
}
