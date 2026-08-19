import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import {
  AttachmentUploadTarget,
  CreateAttachmentUploadUrlCommand,
  StoragePort,
} from '../ports/storage.port';

/** How long an issued `uploadUrl` accepts a PUT before it's rejected. */
const UPLOAD_URL_TTL_MINUTES = 30;

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * LOCAL DEV/TEST ONLY placeholder implementation of `StoragePort` — writes
 * to a local `./var/uploads/` directory and serves files back via
 * `UploadsController`. Replace with a real object-storage adapter
 * (S3/Cloudinary/Azure Blob) once that infrastructure decision is made (see
 * infrastructure.md's open hosting-provider question); this adapter's only
 * job is to make `requestServiceRequestAttachmentUploadUrl`/
 * `publishServiceRequest` real and testable today. Same "no real provider
 * decided yet, seam built now" posture already established for
 * `CustomerProfile.photoUrl`/`ProfessionalProfile.photoUrl`.
 *
 * Upload tokens are HMAC-SHA256-signed over `key:expiresAtMillis`, verified
 * with `timingSafeEqual` — same signing/verification discipline
 * `DiditIdentityVerificationAdapter.verifyWebhookSignature` already
 * establishes for this codebase. The signing secret is read from
 * `ConfigService` (`storageLocal.signingSecret`) when set; otherwise a
 * fresh random secret is generated once at construction and held for this
 * adapter instance's lifetime (the whole app process) — acceptable for a
 * local-dev/test-only seam protecting nothing but a throwaway local file,
 * mirroring `test/support/test-app.ts`'s own ephemeral-secret precedent for
 * `ADMIN_CREDENTIALS_ENCRYPTION_KEY`.
 */
@Injectable()
export class LocalDevStorageAdapter implements StoragePort {
  private readonly signingSecret: string;
  private readonly uploadsDir = join(process.cwd(), 'var', 'uploads');

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.signingSecret =
      this.configService.get('storageLocal', { infer: true }).signingSecret ??
      randomBytes(32).toString('hex');
  }

  // Not `async` — nothing here awaits (no real network/disk call is needed
  // to compose these URLs); `StoragePort.createUploadUrl`'s signature stays
  // `Promise`-returning because a real object-storage adapter (S3/etc.)
  // will genuinely need to await a provider call.
  createUploadUrl(
    command: CreateAttachmentUploadUrlCommand,
  ): Promise<AttachmentUploadTarget> {
    const extension = CONTENT_TYPE_EXTENSIONS[command.contentType] ?? '';
    const key = `${randomBytes(16).toString('hex')}${extension}`;
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MINUTES * 60_000);
    const token = this.signToken(key, expiresAt.getTime());
    const baseUrl = this.configService.get('storageLocal', {
      infer: true,
    }).baseUrl;

    return Promise.resolve({
      uploadUrl: `${baseUrl}/uploads/${key}?token=${token}&expires=${expiresAt.getTime()}`,
      publicUrl: `${baseUrl}/uploads/${key}`,
      expiresAt,
    });
  }

  /** Used by `UploadsController.put` before accepting bytes for `key`. */
  verifyUploadToken(
    key: string,
    expiresAtMillis: number,
    token: string,
  ): boolean {
    if (!Number.isFinite(expiresAtMillis) || Date.now() > expiresAtMillis) {
      return false;
    }
    const expected = this.signToken(key, expiresAtMillis);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(token, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length) {
      // `timingSafeEqual` throws on mismatched lengths — checked explicitly
      // first, same precedent as `DiditIdentityVerificationAdapter`.
      return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  /** Used by `UploadsController.put` — writes the raw bytes for `key`. */
  async writeFile(key: string, bytes: Buffer): Promise<void> {
    await mkdir(this.uploadsDir, { recursive: true });
    await writeFile(this.pathFor(key), bytes);
  }

  /** Used by `UploadsController.get` — `null` if `key` was never written. */
  async readFile(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  private pathFor(key: string): string {
    // `key` is always one of OUR OWN `randomBytes(16).toString('hex')`
    // (+ a fixed allow-listed extension) values — never client-chosen —
    // but this is still checked defensively so a malformed/foreign `key`
    // (e.g. containing `..`/`/`) can never escape `uploadsDir`.
    if (!/^[a-f0-9]{32}(\.[a-z]+)?$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return join(this.uploadsDir, key);
  }

  private signToken(key: string, expiresAtMillis: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${expiresAtMillis}`, 'utf8')
      .digest('hex');
  }
}
