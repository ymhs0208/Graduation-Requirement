export class HttpError extends Error {
  status: number
  code: string
  messageZh?: string
  messageEn?: string

  constructor(status: number, code: string, text?: { zh: string; en: string }) {
    super(code)
    this.status = status
    this.code = code
    this.messageZh = text?.zh
    this.messageEn = text?.en
  }
}
