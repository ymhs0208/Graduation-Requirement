import { createApp } from './app'
import { prisma } from './db'
import { env } from './env'
import { maybeScheduledPreaudit, runReminders } from './jobs'
import { seed } from './seed'

async function main() {
  if (env.demoSeed) {
    const count = await prisma.user.count()
    if (count === 0) await seed()
  }
  const app = createApp()
  app.listen(env.port, '0.0.0.0', () => {
    console.log(`API listening on ${env.port}`)
  })
  if (env.nodeEnv === 'production') {
    setInterval(() => {
      maybeScheduledPreaudit().catch((error) => console.error(error))
      runReminders().catch((error) => console.error(error))
    }, 60 * 60 * 1000)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
