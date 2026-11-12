import { sign, verify } from 'jsonwebtoken';
import { hashSync, compareSync } from 'bcrypt';
import crypto from 'crypto';
import dayjs from 'dayjs';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm);

function deriveLegacyKeyIv(secret: string) {
  const { keyLength, ivLength } = crypto.getCipherInfo(algorithm); // 32, 16
  const pass = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'utf8');

  // evp_bytestokey: key length in **bits**, IV length in **bytes**
  const { key, iv } = EVP_BytesToKey(pass, null, keyLength * 8, ivLength, 'md5');

  if (key.length !== keyLength || iv.length !== ivLength) {
    throw new Error(`Derived wrong sizes (key=${key.length}, iv=${iv.length})`);
  }
  return { key, iv };
}

export function decrypt_legacy_using_IV(hexCiphertext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([decipher.update(hexCiphertext, 'hex'), decipher.final()]);
  return out.toString('utf8');
}

export function encrypt_legacy_using_IV(utf8Plaintext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const out = Buffer.concat([cipher.update(utf8Plaintext, 'utf8'), cipher.final()]);
  return out.toString('hex');
}
export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 10);
  }
  static comparePassword(password: string, hash: string) {
    return compareSync(password, hash);
  }
  static signJWT(value: object) {
    return sign(value, process.env.JWT_SECRET!);
  }
  static verifyJWT(token: string) {
    return verify(token, process.env.JWT_SECRET!);
  }

  static verifySessionJWT(token: string): { id: string } {
    const payload = verify(token, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
    });
    // Historical login tokens contain the User record. Keep those sessions
    // working, but never interpret reset/invitation/provisioning tokens as users.
    // These fields identify the format; permissions still come from the DB.
    if (
      typeof payload === 'string' ||
      typeof payload.id !== 'string' ||
      !payload.id ||
      typeof payload.email !== 'string' ||
      typeof payload.providerName !== 'string' ||
      typeof payload.activated !== 'boolean' ||
      'expires' in payload ||
      'timeLimit' in payload ||
      'purpose' in payload
    ) {
      throw new Error('Invalid session token');
    }
    return { id: payload.id };
  }

  private static passwordResetKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret?.trim()) {
      throw new Error('JWT_SECRET is required for password reset');
    }
    // Same domain-separation approach as upstream PR #2382. Other JWTs and
    // encrypted channel credentials continue to use their existing keys.
    return crypto
      .createHmac('sha256', secret)
      .update('postiz:user-auth:v1:password-reset')
      .digest();
  }

  static signPasswordResetToken(userId: string) {
    return sign({ purpose: 'password-reset' }, this.passwordResetKey(), {
      algorithm: 'HS256',
      issuer: 'postiz',
      audience: 'password-reset',
      subject: userId,
      expiresIn: 20 * 60,
    });
  }

  static verifyPasswordResetToken(token: string): { id: string } {
    try {
      const payload = verify(token, this.passwordResetKey(), {
        algorithms: ['HS256'],
        issuer: 'postiz',
        audience: 'password-reset',
      });
      if (
        typeof payload === 'string' ||
        payload.purpose !== 'password-reset' ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp)
      ) {
        throw new Error('Invalid password reset token');
      }
      return { id: payload.sub };
    } catch {
      // Links already emailed before the upgrade remain usable only for their
      // original lifetime. Never let another legacy JWT purpose use this path.
      const payload = verify(token, process.env.JWT_SECRET!, {
        algorithms: ['HS256'],
      });
      if (
        typeof payload === 'string' ||
        typeof payload.id !== 'string' ||
        !payload.id ||
        typeof payload.expires !== 'string' ||
        Object.keys(payload).some((key) => !['id', 'expires', 'iat'].includes(key))
      ) {
        throw new Error('Invalid password reset token');
      }
      const expires = dayjs(payload.expires);
      if (
        !expires.isValid() ||
        expires.format('YYYY-MM-DD HH:mm:ss') !== payload.expires ||
        !expires.isAfter(dayjs())
      ) {
        throw new Error('Expired or invalid password reset token');
      }
      return { id: payload.id };
    }
  }

  static fixedEncryption(value: string) {
    return encrypt_legacy_using_IV(value);
  }

  static fixedDecryption(hash: string) {
    return decrypt_legacy_using_IV(hash);
  }
}
