// Start the backend only after Vite has bound its local port. Keeping this
// tiny sequencing shim separate lets scripts/dev.mjs retain concurrently's
// prefixed output and shared shutdown behaviour.
import net from 'node:net'
import { spawn } from 'node:child_process'

const [python, ...args] = process.argv.slice(2)
const host = '127.0.0.1'
const port = 5173
const retryMs = 100

if (!python) {
  process.stderr.write('dev: backend launcher needs a Python interpreter path\n')
  process.exit(1)
}

function studioIsListening() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForStudio() {
  while (!(await studioIsListening())) {
    await new Promise((resolve) => setTimeout(resolve, retryMs))
  }
}

await waitForStudio()
const backend = spawn(python, args, { stdio: 'inherit' })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => backend.kill(signal))
}

backend.once('error', (error) => {
  process.stderr.write(`dev: could not start backend: ${error.message}\n`)
  process.exit(1)
})
backend.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
