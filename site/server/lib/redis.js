import net from 'node:net'
import tls from 'node:tls'

function encodeCommand(args) {
  let out = `*${args.length}\r\n`
  for (const arg of args) {
    const str = String(arg)
    out += `$${Buffer.byteLength(str)}\r\n${str}\r\n`
  }
  return out
}

function parseReply(buffer) {
  const str = buffer.toString('utf8')
  const lineEnd = str.indexOf('\r\n')
  if (lineEnd === -1) return { done: false, value: null }
  const prefix = str[0]
  const head = str.slice(1, lineEnd)

  if (prefix === '+' || prefix === ':') {
    return { done: true, value: prefix === ':' ? Number(head) : head }
  }
  if (prefix === '-') {
    return { done: true, error: new Error(head) }
  }
  if (prefix === '$') {
    const len = Number(head)
    if (len === -1) return { done: true, value: null }
    const start = lineEnd + 2
    const end = start + len
    if (buffer.length < end + 2) return { done: false, value: null }
    return { done: true, value: buffer.subarray(start, end).toString('utf8') }
  }
  return { done: true, value: head }
}

/**
 * Minimal zero-dependency Redis command runner used only when REDIS_URL is set.
 * Keeps cold starts fast and avoids extra npm dependencies.
 */
export async function redisCommand(...args) {
  const rawUrl = process.env.REDIS_URL
  if (!rawUrl) return null

  const url = new URL(rawUrl)
  const useTls = url.protocol === 'rediss:'
  const host = url.hostname || '127.0.0.1'
  const port = Number(url.port || 6379)
  const password = url.password ? decodeURIComponent(url.password) : ''
  const username = url.username ? decodeURIComponent(url.username) : ''

  return new Promise((resolve, reject) => {
    const connect = useTls ? tls.connect : net.createConnection
    const socket = connect({ host, port, timeout: 1500 })
    const chunks = []
    let stage = password ? 'auth' : 'cmd'

    const cleanup = (err, val) => {
      socket.destroy()
      if (err) reject(err)
      else resolve(val)
    }

    socket.on('timeout', () => cleanup(new Error('Redis timeout')))
    socket.on('error', (err) => cleanup(err))
    socket.on('connect', () => {
      if (stage === 'auth') {
        const authArgs = username ? ['AUTH', username, password] : ['AUTH', password]
        socket.write(encodeCommand(authArgs))
      } else {
        socket.write(encodeCommand(args))
      }
    })
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      const parsed = parseReply(Buffer.concat(chunks))
      if (!parsed.done) return
      chunks.length = 0
      if (parsed.error) return cleanup(parsed.error)
      if (stage === 'auth') {
        stage = 'cmd'
        socket.write(encodeCommand(args))
      } else {
        cleanup(null, parsed.value)
      }
    })
  })
}
