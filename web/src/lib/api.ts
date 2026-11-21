import { toast } from 'sonner'

let csrf = ''
const connectionListeners = new Set<() => void>()

export function setCsrf(token: string) {
  csrf = token
}

export function onConnectionProblem(listener: () => void) {
  connectionListeners.add(listener)
  return () => connectionListeners.delete(listener)
}

function reportConnection() {
  connectionListeners.forEach((listener) => listener())
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
    if (error.code === 'OFFLINE' || error.code === 'TIMEOUT') return locale === 'en' ? 'Connection lost. Try again.' : '連線中斷，請重試'
    const text = locale === 'en' ? error.messageEn : error.messageZh
    if (text) return text
  }
  return fallback
}

function toastText(error: ApiError) {
  const english = document.documentElement.lang === 'en'
  if (error.code === 'OFFLINE' || error.code === 'TIMEOUT') return english ? 'Connection lost. Try again.' : '連線中斷，請重試'
  return (english ? error.messageEn : error.messageZh) || error.code
}

type Options = {
  method?: string
  body?: unknown
  form?: FormData
  timeout?: number
  signal?: AbortSignal
  onProgress?: (percent: number) => void
  success?: string
  silent?: boolean
}

function fail(error: ApiError, silent?: boolean): never {
  if (!silent && error.code !== 'CANCELLED') {
    if (error.code === 'OFFLINE' || error.code === 'TIMEOUT') reportConnection()
    else toast.error(toastText(error))
  }
  throw error
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return fail(new ApiError('OFFLINE', '連線中斷，請重試', 'Connection lost. Try again.'), options.silent)
  }
  const method = options.method ?? (options.form || options.body !== undefined ? 'POST' : 'GET')
  const timeout = options.timeout ?? (options.form ? 60000 : 20000)
  try {
    const data = options.onProgress || options.form
      ? await xhr<T>(path, { ...options, method, timeout })
      : await jsonFetch<T>(path, { ...options, method, timeout })
    if (options.success) toast.success(options.success)
    return data
  } catch (error) {
    if (error instanceof ApiError) return fail(error, options.silent)
    reportConnection()
    return fail(new ApiError('OFFLINE', '連線中斷，請重試', 'Connection lost. Try again.'), options.silent)
  }
}

async function jsonFetch<T>(path: string, options: Options & { method: string; timeout: number }): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeout)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)
  try {
    const headers: Record<string, string> = {}
    if (csrf) headers['X-CSRF-Token'] = csrf
    let body: BodyInit | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const response = await fetch(path, { method: options.method, credentials: 'include', headers, body, signal: controller.signal })
    return await readPayload<T>(response)
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError('CANCELLED', '已取消', 'Cancelled')
    if (error instanceof ApiError) throw error
    throw new ApiError('TIMEOUT', '連線中斷，請重試', 'Connection lost. Try again.')
  } finally {
    window.clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function xhr<T>(path: string, options: Options & { method: string; timeout: number }): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(options.method, path)
    request.withCredentials = true
    if (csrf) request.setRequestHeader('X-CSRF-Token', csrf)
    let settled = false
    const timer = window.setTimeout(() => {
      settled = true
      request.abort()
      reject(new ApiError('TIMEOUT', '連線中斷，請重試', 'Connection lost. Try again.'))
    }, options.timeout)
    const onAbort = () => request.abort()
    options.signal?.addEventListener('abort', onAbort)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.max(1, Math.round((event.loaded / event.total) * 100)))
    }
    request.onload = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      let payload: { error?: string; messageZh?: string; messageEn?: string; csrfToken?: string } = {}
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : {}
      } catch {
        reject(new ApiError('SERVER'))
        return
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(payload.error ?? 'SERVER', payload.messageZh, payload.messageEn))
        return
      }
      if (payload.csrfToken) setCsrf(payload.csrfToken)
      options.onProgress?.(100)
      resolve(payload as T)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(new ApiError('OFFLINE', '連線中斷，請重試', 'Connection lost. Try again.'))
    }
    request.onabort = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(options.signal?.aborted ? new ApiError('CANCELLED', '已取消', 'Cancelled') : new ApiError('TIMEOUT', '連線中斷，請重試', 'Connection lost. Try again.'))
    }
    if (options.form) request.send(options.form)
    else {
      request.setRequestHeader('Content-Type', 'application/json')
      request.send(JSON.stringify(options.body ?? {}))
    }
  })
}

async function readPayload<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new ApiError(data.error ?? 'SERVER', data.messageZh, data.messageEn)
  if (data.csrfToken) setCsrf(data.csrfToken)
  return data as T
}
