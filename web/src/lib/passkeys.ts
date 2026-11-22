import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { ApiError, api, errorMessage } from './api'

export type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null }

export function supportsPasskeys() {
  return window.isSecureContext && browserSupportsWebAuthn()
}

export async function authenticatePasskey(account: string, password: string) {
  const { options, challengeId } = await api<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>('/api/auth/login', {
    body: { account, password, passkey: { action: 'start' } }, silent: true,
  })
  const credential = await startAuthentication({ optionsJSON: options })
  const result = await api<{ user?: { role: string } }>('/api/auth/login', {
    body: { account, password, passkey: { action: 'finish', challengeId, credential } }, silent: true,
  })
  if (result.user?.role !== 'ADMIN') throw new ApiError('SERVER')
}

export async function registerPasskey(token: string, name: string) {
  const { options, challengeId } = await api<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>('/api/auth/passkeys/register/options', {
    body: { token }, silent: true,
  })
  const credential = await startRegistration({ optionsJSON: options })
  const result = await api<{ key?: Passkey }>('/api/auth/passkeys/register/verify', {
    body: { challengeId, credential, name }, silent: true,
  })
  if (!result.key?.id) throw new ApiError('SERVER')
  return result.key
}

export function passkeyError(error: unknown, locale: 'zh-Hant' | 'en', fallback: string, interrupted: string) {
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError' ||
    ('cause' in error && error.cause instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.cause.name)))) {
    return interrupted
  }
  return errorMessage(error, locale, fallback)
}
