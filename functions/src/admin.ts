import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app'

/**
 * Cloud Functions and the emulators use ambient credentials. Netlify has no
 * ambient identity, so it supplies the service account key as base64 JSON in
 * FIREBASE_SERVICE_ACCOUNT_B64 (base64 survives shells and dashboards that
 * mangle backslash escapes inside the JSON).
 */
export function adminApp(): App {
  const [existing] = getApps()
  if (existing) {
    return existing
  }

  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_B64
  if (!encoded) {
    return initializeApp()
  }
  const raw = Buffer.from(encoded, 'base64').toString('utf8')

  let parsed: {
    project_id?: string
    client_email?: string
    private_key?: string
  }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 does not decode to JSON.')
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      'The service account key is missing project_id, client_email, or private_key.',
    )
  }

  const serviceAccount: ServiceAccount = {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
  })
}
