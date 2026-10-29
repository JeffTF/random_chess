import { createVerify } from 'node:crypto'

// firebase-admin's auth module pulls in jwks-rsa, which require()s the
// ESM-only jose package and crashes under the Netlify function runtime, so the
// HTTP adapter verifies ID tokens itself against Google's published certs.

const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const ISSUER = 'https://securetoken.google.com/'
const MIN_CERT_TTL_MS = 60 * 1000
const MAX_CERT_TTL_MS = 6 * 60 * 60 * 1000
const CLOCK_SKEW_SECONDS = 60

export interface IdTokenOptions {
  projectId: string
  /** Test seam: returns the PEM certificate for a key id. */
  resolveKey?: (kid: string) => Promise<string>
  nowSeconds?: number
  /** Auth emulator tokens are unsigned (alg "none"), as in the Admin SDK. */
  emulator?: boolean
}

interface CertCache {
  certs: Map<string, string>
  expiresAt: number
}

let certCache: CertCache | null = null

function certTtlMs(cacheControl: string | null): number {
  const match = cacheControl ? /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl) : null
  const seconds = match?.[1] === undefined ? 3600 : Number(match[1])
  return Math.min(Math.max(seconds * 1000, MIN_CERT_TTL_MS), MAX_CERT_TTL_MS)
}

async function fetchCerts(): Promise<CertCache> {
  const response = await fetch(CERT_URL)
  if (!response.ok) {
    throw new Error(`Could not load Firebase signing keys (${response.status}).`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const certs = new Map<string, string>()
  for (const [kid, pem] of Object.entries(body)) {
    if (typeof pem === 'string') {
      certs.set(kid, pem)
    }
  }
  certCache = { certs, expiresAt: Date.now() + certTtlMs(response.headers.get('cache-control')) }
  return certCache
}

async function googleKey(kid: string): Promise<string> {
  if (!certCache || certCache.expiresAt <= Date.now()) {
    await fetchCerts()
  }
  const cached = certCache?.certs.get(kid)
  if (cached) {
    return cached
  }
  // A missing kid usually means key rotation; refetch once before giving up.
  return (await fetchCerts()).certs.get(kid) ?? fail('Unknown token signing key.')
}

function fail(message: string): never {
  throw new Error(message)
}

function segment(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return fail('Token segment is not valid JSON.')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('Token segment is not a JSON object.')
  }
  return value as Record<string, unknown>
}

/** Verifies a Firebase ID token and returns its uid; throws otherwise. */
export async function verifyFirebaseIdToken(
  token: string,
  options: IdTokenOptions,
): Promise<string> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    fail('Token does not have three segments.')
  }
  const rawHeader = parts[0] ?? ''
  const rawPayload = parts[1] ?? ''
  const rawSignature = parts[2] ?? ''
  const header = segment(rawHeader)
  const payload = segment(rawPayload)

  if (options.emulator) {
    if (header.alg !== 'none') {
      fail('Emulator tokens must be unsigned.')
    }
  } else {
    if (header.alg !== 'RS256') {
      fail('Token algorithm must be RS256.')
    }
    const kid = header.kid
    if (typeof kid !== 'string' || kid === '') {
      fail('Token has no key id.')
    }
    const key = await (options.resolveKey ?? googleKey)(kid)
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${rawHeader}.${rawPayload}`)
    verifier.end()
    if (!verifier.verify(key, Buffer.from(rawSignature, 'base64url'))) {
      fail('Token signature is invalid.')
    }
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const { aud, iss, exp, iat, sub } = payload
  if (aud !== options.projectId) {
    fail('Token audience does not match this project.')
  }
  if (iss !== `${ISSUER}${options.projectId}`) {
    fail('Token issuer does not match this project.')
  }
  if (typeof exp !== 'number' || exp <= now) {
    fail('Token has expired.')
  }
  if (typeof iat !== 'number' || iat > now + CLOCK_SKEW_SECONDS) {
    fail('Token was issued in the future.')
  }
  if (typeof sub !== 'string' || sub === '' || sub.length > 128) {
    fail('Token has no usable subject.')
  }
  return sub
}
