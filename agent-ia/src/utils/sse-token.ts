import { createHmac } from 'crypto';

interface SseTokenPayload {
  sub: string;
  tid: string;
  iss: 'lidfe';
  aud: 'sse';
  typ: 'sse';
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function hmacSha256(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload, 'utf8').digest();
}

function deriveSseKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('lidfe-sse-token-v1', 'utf8').digest();
}

export function createSseToken(params: {
  secret: string;
  userId: string;
  threadId: string;
  ttlSeconds: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SseTokenPayload = {
    sub: params.userId,
    tid: params.threadId,
    iss: 'lidfe',
    aud: 'sse',
    typ: 'sse',
    iat: now,
    exp: now + params.ttlSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = hmacSha256(deriveSseKey(params.secret), signingInput);
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}
