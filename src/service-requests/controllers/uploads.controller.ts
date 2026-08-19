import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LocalDevStorageAdapter } from '../adapters/local-dev-storage.adapter';

/**
 * The second REST (non-GraphQL) endpoint in this backend, after
 * `DiditWebhookController` — the actual PUT/GET target for
 * `LocalDevStorageAdapter`'s `uploadUrl`/`publicUrl` (see that class's own
 * header comment). Not part of either GraphQL schema's `include` array
 * (`src/app.module.ts`) — a plain Express route.
 *
 * Deliberately public/unauthenticated (`GET`, and `PUT` protected only by
 * its own signed token, not `SessionGuard`) — same trust model
 * `CustomerProfile.photoUrl`/`ProfessionalProfile.photoUrl` already have
 * today: any URL handed out for one of these fields is treated as a public
 * image/file URL, not an access-controlled resource. `PUT` reads the
 * request body directly off the raw Node stream rather than relying on any
 * global body-parser, so it works for arbitrary binary content-types
 * (Nest's default `express.json()`/`express.urlencoded()` middleware only
 * consumes the stream for their own matching content-types, so it is left
 * untouched here as long as the client's `Content-Type` is one of this
 * module's allow-listed content types — see
 * `RequestServiceRequestAttachmentUploadUrlService`).
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storageAdapter: LocalDevStorageAdapter) {}

  @Put(':key')
  async put(
    @Param('key') key: string,
    @Query('token') token: string | undefined,
    @Query('expires') expires: string | undefined,
    @Req() req: Request,
  ): Promise<{ stored: boolean }> {
    const expiresAtMillis = Number(expires);
    if (
      !token ||
      !this.storageAdapter.verifyUploadToken(key, expiresAtMillis, token)
    ) {
      // A generic 401 — never discloses WHY (missing token, bad signature,
      // expired), same anti-enumeration discipline as
      // `DiditWebhookController`'s signature check.
      throw new UnauthorizedException();
    }

    const bytes = await this.readRawBody(req);
    await this.storageAdapter.writeFile(key, bytes);
    return { stored: true };
  }

  @Get(':key')
  async get(@Param('key') key: string, @Res() res: Response): Promise<void> {
    const bytes = await this.storageAdapter.readFile(key);
    if (!bytes) {
      throw new NotFoundException();
    }
    res.send(bytes);
  }

  private readRawBody(req: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
