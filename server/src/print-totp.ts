import { currentTotp } from './crypto'
import { DEMO_ADMIN_TOTP } from './demo'

const secret = process.argv[2] || DEMO_ADMIN_TOTP
console.log(currentTotp(secret))
