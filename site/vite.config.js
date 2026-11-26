import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.join(rootDir, 'server', 'handlers')
const MAX_LOCAL_BODY_BYTES = 8 * 1024 * 1024

function localApiError(outgoing, status, error) {
  outgoing.statusCode = status
  outgoing.setHeader('Content-Type', 'application/json')
  outgoing.end(JSON.stringify({
    error: status === 404
      ? 'API route not found'
      : status === 400
        ? 'Invalid request'
        : 'Internal server error',
  }))
  if (error) console.error('[local-api]', error)
}

function localApiPlugin() {
  return {
    name: 'local-vite-api',
    configureServer(server) {
      server.middlewares.use('/api', async (incoming, outgoing) => {
        try {
          const pathname = incoming.url?.split('?')[0].replace(/^\/+|\/+$/g, '') || ''
          const segments = pathname.split('/').filter(Boolean)
          let handlerPath = null

          const isSafeName = (value) => /^[A-Za-z0-9_-]{1,60}$/.test(value)
          if (segments.length === 1 && isSafeName(segments[0])) {
            const candidate = path.resolve(apiRoot, `${segments[0]}.js`)
            if (candidate.startsWith(apiRoot + path.sep)) handlerPath = candidate
          } else if (segments[0] === 'media' && segments.length === 2 && isSafeName(segments[1])) {
            const fileName = ['start', 'chunk', 'complete'].includes(segments[1])
              ? segments[1]
              : '[id]'
            const candidate = path.resolve(apiRoot, 'media', `${fileName}.js`)
            if (candidate.startsWith(path.join(apiRoot, 'media') + path.sep)) {
              handlerPath = candidate
            }
          }

          if (!handlerPath || !fs.existsSync(handlerPath) || !fs.statSync(handlerPath).isFile()) {
            return localApiError(outgoing, 404)
          }

          const declaredLength = Number(incoming.headers['content-length'] || 0)
          if (declaredLength > MAX_LOCAL_BODY_BYTES) {
            return localApiError(outgoing, 400)
          }

          const chunks = []
          let received = 0
          if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
            for await (const chunk of incoming) {
              received += chunk.length
              if (received > MAX_LOCAL_BODY_BYTES) return localApiError(outgoing, 400)
              chunks.push(chunk)
            }
          }
          const rawBody = Buffer.concat(chunks)
          let body = {}
          if (rawBody.length) {
            const contentType = String(incoming.headers['content-type'] || '')
            if (!contentType.includes('application/json')) {
              return localApiError(outgoing, 400)
            }
            body = JSON.parse(rawBody.toString('utf8'))
          }

          const url = new URL(incoming.url || '/', 'http://localhost')
          const query = Object.fromEntries(url.searchParams.entries())
          if (segments[0] === 'media' && segments.length === 2 &&
              !['start', 'chunk', 'complete'].includes(segments[1])) {
            query.id = segments[1]
          }
          const moduleUrl = pathToFileURL(handlerPath).href
          const module = await import(`${moduleUrl}?t=${Date.now()}`)
          const request = {
            method: incoming.method,
            headers: incoming.headers,
            body,
            query,
            url: incoming.url,
          }
          let statusCode = 200
          const response = {
            status(code) {
              statusCode = code
              outgoing.statusCode = code
              return this
            },
            setHeader(name, value) {
              outgoing.setHeader(name, value)
              return this
            },
            send(value) {
              if (Buffer.isBuffer(value)) {
                outgoing.end(value)
              } else if (typeof value === 'object') {
                outgoing.setHeader('Content-Type', 'application/json')
                outgoing.end(JSON.stringify(value))
              } else {
                outgoing.end(value)
              }
            },
            json(value) {
              outgoing.statusCode = statusCode
              outgoing.setHeader('Content-Type', 'application/json')
              outgoing.end(JSON.stringify(value))
            },
            end(value) {
              outgoing.end(value)
            },
          }

          await module.default(request, response)
        } catch (error) {
          localApiError(outgoing, error instanceof SyntaxError ? 400 : 500, error)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  Object.assign(process.env, env)
  return {
    plugins: [react(), tailwindcss(), localApiPlugin()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/')
            if (!normalized.includes('/node_modules/')) return undefined
            if (normalized.includes('/exceljs/')) return 'exceljs'
            if (normalized.includes('/@supabase/')) return 'supabase'
            if (normalized.includes('/motion/') || normalized.includes('/motion-dom/') ||
                normalized.includes('/motion-utils/')) return 'motion'
            if (normalized.includes('/react/') || normalized.includes('/react-dom/') ||
                normalized.includes('/scheduler/')) return 'react-vendor'
            return undefined
          },
        },
      },
      // ExcelJS is loaded on demand only; the initial route payload is ~151 KB gzip.
      chunkSizeWarningLimit: 1000,
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./tests/setup.js'],
      include: ['tests/**/*.test.{js,jsx}'],
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
      css: false,
    },
  }
})
