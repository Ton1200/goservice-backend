import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PasswordHasherPort } from '../ports/password-hasher.port';

/**
 * argon2id password hashing (GOS-8/GOS-22 mandatory security requirement).
 * Never logs the plaintext or hashed password — callers must not log
 * either value either.
 */
@Injectable()
export class Argon2PasswordHasherAdapter implements PasswordHasherPort {
  async hash(plainTextPassword: string): Promise<string> {
    return argon2.hash(plainTextPassword, { type: argon2.argon2id });
  }

  async verify(hash: string, plainTextPassword: string): Promise<boolean> {
    return argon2.verify(hash, plainTextPassword);
  }
}
