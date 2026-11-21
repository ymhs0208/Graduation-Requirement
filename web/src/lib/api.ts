let csrf = ''

export function setCsrf(token: string) {
  csrf = token
}

export class ApiError extends Error {
  code: string
  messageZh?: string
  messageEn?: string
  constructor(code: string, messageZh?: string, messageEn?: string) {
    super(code)
    this.code = code
    this.messageZh = messageZh
    this.messageEn = messageEn
  }
}

export function errorMessage(error: unknown, locale: 'zh-Hant' | 'en', fallback: string) {
  if (error instanceof ApiError) {
    const text = locale === 'en' ? error.messageEn : error.messageZh
    if (text) return text
  }
  return fallback
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (csrf) headers['X-CSRF-Token'] = csrf
  let body: BodyInit | undefined
  if (options.form) body = options.form
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetch(path, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    credentials: 'include',
    headers,
    body,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new ApiError(data.error ?? 'SERVER', data.messageZh, data.messageEn)
  if (data.csrfToken) setCsrf(data.csrfToken)
  return data as T
}
