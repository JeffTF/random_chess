import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyFirebaseIdToken, type IdTokenOptions } from './idToken'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PROJECT = 'demo-project'
const NOW = 1_700_000_000

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

const CLAIMS = {
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  sub: 'user-1',
  iat: NOW - 30,
  exp: NOW + 3600,
}

function token(
  claims: Record<string, unknown> = CLAIMS,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'kid-1' },
): string {
  const head = encode(header)
  const body = encode(claims)
  const signer = createSign('RSA-SHA256')
  signer.update(`${head}.${body}`)
  signer.end()
  return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`
}

function options(overrides: Partial<IdTokenOptions> = {}): IdTokenOptions {
  return {
    projectId: PROJECT,
    resolveKey: async () => PUBLIC_PEM,
    nowSeconds: NOW,
    ...overrides,
  }
}

describe('verifyFirebaseIdToken', () => {
  it('returns the subject of a correctly signed token', async () => {
    await expect(verifyFirebaseIdToken(token(), options())).resolves.toBe('user-1')
  })

  it('rejects an expired token', async () => {
    await expect(
      verifyFirebaseIdToken(token({ ...CLAIMS, exp: NOW - 1 }), options()),
    ).rejects.toThrow(/expired/i)
  })

  it('rejects a token from another project', async () => {
    await expect(
      verifyFirebaseIdToken(token({ ...CLAIMS, aud: 'other' }), options()),
    ).rejects.toThrow(/audience/i)
    await expect(
      verifyFirebaseIdToken(
        token({ ...CLAIMS, iss: 'https://securetoken.google.com/other' }),
        options(),
      ),
    ).rejects.toThrow(/issuer/i)
  })

  it('rejects a token issued more than a minute in the future', async () => {
    await expect(
      verifyFirebaseIdToken(token({ ...CLAIMS, iat: NOW + 61 }), options()),
    ).rejects.toThrow(/future/i)
  })

  it('rejects an empty subject', async () => {
    await expect(
      verifyFirebaseIdToken(token({ ...CLAIMS, sub: '' }), options()),
    ).rejects.toThrow(/subject/i)
  })

  it('rejects a token whose signature does not match', async () => {
    const valid = token()
    const parts = valid.split('.')
    const tampered = `${parts[0]}.${encode({ ...CLAIMS, sub: 'someone-else' })}.${parts[2]}`
    await expect(verifyFirebaseIdToken(tampered, options())).rejects.toThrow(
      /signature/i,
    )
  })

  it('rejects a token signed with a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const head = encode({ alg: 'RS256', kid: 'kid-1' })
    const body = encode(CLAIMS)
    const signer = createSign('RSA-SHA256')
    signer.update(`${head}.${body}`)
    signer.end()
    const forged = `${head}.${body}.${signer.sign(other.privateKey).toString('base64url')}`
    await expect(verifyFirebaseIdToken(forged, options())).rejects.toThrow(
      /signature/i,
    )
  })

  it('rejects algorithms other than RS256', async () => {
    await expect(
      verifyFirebaseIdToken(token(CLAIMS, { alg: 'HS256', kid: 'kid-1' }), options()),
    ).rejects.toThrow(/RS256/i)
    await expect(
      verifyFirebaseIdToken(token(CLAIMS, { alg: 'none' }), options()),
    ).rejects.toThrow(/RS256/i)
  })

  it('rejects malformed tokens', async () => {
    await expect(verifyFirebaseIdToken('not-a-token', options())).rejects.toThrow(
      /three segments/i,
    )
    await expect(
      verifyFirebaseIdToken('a.b.c', options()),
    ).rejects.toThrow(/not valid JSON/i)
  })

  it('accepts unsigned tokens only in emulator mode', async () => {
    const emulatorToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(CLAIMS)}.`
    await expect(
      verifyFirebaseIdToken(emulatorToken, options({ emulator: true })),
    ).resolves.toBe('user-1')
    await expect(
      verifyFirebaseIdToken(token(), options({ emulator: true })),
    ).rejects.toThrow(/unsigned/i)
  })
})
