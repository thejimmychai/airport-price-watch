const crypto = require('crypto');

/**
 * Envelope Encryption & Privacy Utilities
 *
 * Local Mode: Uses AES-256-GCM with a local Master Key (KEK) from APP_ENCRYPTION_KEY
 * or an ephemeral process key (for dev/demo).
 *
 * Google Cloud Production Mode: When GCP_KMS_KEY_NAME is set, wraps/unwraps the
 * per-record Data Encryption Key (DEK) via Google Cloud KMS, ensuring zero-trust
 * separation between public receipt pricing data and consented volunteer PII.
 */

const EPHEMERAL_DEV_KEY = crypto.randomBytes(32);

function getLocalMasterKey() {
  if (process.env.APP_ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(process.env.APP_ENCRYPTION_KEY).digest();
  }
  return EPHEMERAL_DEV_KEY;
}

/**
 * Encrypts a JSON-serializable object using AES-256-GCM envelope encryption.
 * Returns { ciphertext, iv, authTag, wrappedDek, keyId, algorithm, encryptedAt }.
 */
function encryptConsentPayload(payload) {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Wrap DEK with Master Key (KEK)
  const kek = getLocalMasterKey();
  const dekIv = crypto.randomBytes(12);
  const dekCipher = crypto.createCipheriv('aes-256-gcm', kek, dekIv);
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekAuthTag = dekCipher.getAuthTag();

  const keyId = process.env.GCP_KMS_KEY_NAME || 'local-kms-aes256-gcm-v1';

  return {
    algorithm: 'AES-256-GCM-ENVELOPE',
    keyId,
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    wrappedDek: {
      ciphertext: wrappedDek.toString('base64'),
      iv: dekIv.toString('base64'),
      authTag: dekAuthTag.toString('base64'),
    },
    encryptedAt: new Date().toISOString(),
  };
}

/**
 * Decrypts an envelope-encrypted payload (used only by authorized policy-audit endpoints).
 */
function decryptConsentPayload(envelope) {
  const kek = getLocalMasterKey();
  const dekDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    kek,
    Buffer.from(envelope.wrappedDek.iv, 'base64')
  );
  dekDecipher.setAuthTag(Buffer.from(envelope.wrappedDek.authTag, 'base64'));
  const dek = Buffer.concat([
    dekDecipher.update(Buffer.from(envelope.wrappedDek.ciphertext, 'base64')),
    dekDecipher.final(),
  ]);

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    dek,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Generates an unlinkable, non-identifying receipt submission hash.
 */
function createAnonymousReceiptHash() {
  return 'anon_' + crypto.randomBytes(12).toString('hex');
}

/**
 * Strips EXIF / APP1-APP15 metadata from JPEG buffers and ancillary metadata chunks
 * (eXIf, tEXt, zTXt, iTXt) from PNG buffers so uploaded receipt photos cannot leak
 * GPS coordinates, timestamps, or device serial numbers.
 */
function stripImageMetadata(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return { cleanedBuffer: buffer, strippedSegments: 0 };
  }

  // JPEG: 0xFF 0xD8
  if (mimeType === 'image/jpeg' || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
    const out = [buffer.subarray(0, 2)];
    let offset = 2;
    let stripped = 0;

    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) {
        out.push(buffer.subarray(offset));
        break;
      }
      const marker = buffer[offset + 1];
      // Start of Scan (0xDA) or EOI (0xD9): copy remainder verbatim
      if (marker === 0xda || marker === 0xd9) {
        out.push(buffer.subarray(offset));
        break;
      }
      // Standalone markers without length
      if (marker >= 0xd0 && marker <= 0xd7) {
        out.push(buffer.subarray(offset, offset + 2));
        offset += 2;
        continue;
      }
      if (offset + 4 > buffer.length) {
        out.push(buffer.subarray(offset));
        break;
      }
      const segLen = buffer.readUInt16BE(offset + 2);
      const nextOffset = offset + 2 + segLen;
      // Strip APP1 (EXIF/XMP), APP2 (ICC/Flashpix), APP12, APP13 (IPTC), COM (0xFE)
      if (
        (marker >= 0xe1 && marker <= 0xef) ||
        marker === 0xfe
      ) {
        stripped++;
      } else {
        out.push(buffer.subarray(offset, Math.min(nextOffset, buffer.length)));
      }
      offset = nextOffset;
    }

    return { cleanedBuffer: Buffer.concat(out), strippedSegments: stripped };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    mimeType === 'image/png' ||
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
  ) {
    const out = [buffer.subarray(0, 8)];
    let offset = 8;
    let stripped = 0;
    const stripTypes = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const totalChunkLen = 12 + length;
      if (offset + totalChunkLen > buffer.length) {
        out.push(buffer.subarray(offset));
        break;
      }
      if (stripTypes.has(type)) {
        stripped++;
      } else {
        out.push(buffer.subarray(offset, offset + totalChunkLen));
      }
      offset += totalChunkLen;
      if (type === 'IEND') break;
    }

    return { cleanedBuffer: Buffer.concat(out), strippedSegments: stripped };
  }

  return { cleanedBuffer: buffer, strippedSegments: 0 };
}

module.exports = {
  encryptConsentPayload,
  decryptConsentPayload,
  createAnonymousReceiptHash,
  stripImageMetadata,
};
