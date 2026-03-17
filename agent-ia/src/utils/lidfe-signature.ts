import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function buildSignatureBase(params: {
  ts: number;
  nonce: string;
  method: string;
  path: string;
  bodyHash: string;
}): string {
  return `${params.ts}.${params.nonce}.${params.method}.${params.path}.${params.bodyHash}`;
}

export function createServiceSignatureHeaders(params: {
  secret: string;
  method: string;
  path: string;
  body?: string;
  ts?: number;
  nonce?: string;
}): Record<string, string> {
  const ts = params.ts ?? Math.floor(Date.now() / 1000);
  const nonce = params.nonce ?? randomBytes(16).toString('hex');
  const bodyHash = sha256Hex(params.body ?? '');
  const signatureBase = buildSignatureBase({
    ts,
    nonce,
    method: params.method,
    path: params.path,
    bodyHash,
  });
  const signature = hmacHex(params.secret, signatureBase);

  return {
    'x-lidfe-ts': String(ts),
    'x-lidfe-nonce': nonce,
    'x-lidfe-body-sha256': bodyHash,
    'x-lidfe-signature': signature,
  };
}
