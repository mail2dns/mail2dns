import http from 'node:http'

export function makeServer() {
  let records = new Map()  // domain -> record[]
  let requests = { created: [], deleted: [] }

  function json(res, status, body) {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(payload)
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        resolve(raw ? JSON.parse(raw) : null)
      })
    })
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const method = req.method

    // /v1/dns/records/:domain/
    const match = path.match(/^\/v1\/dns\/records\/([^/]+)/)
    if (!match) return json(res, 404, { message: 'Not found' })

    const domain = decodeURIComponent(match[1])

    if (method === 'GET') {
      if (!records.has(domain)) return json(res, 404, { message: `Domain not found: ${domain}` })
      return json(res, 200, { items: records.get(domain) })
    }

    if (method === 'PUT') {
      const body = await readBody(req)
      const incoming = body?.items ?? []
      if (!records.has(domain)) records.set(domain, [])
      records.get(domain).push(...incoming)
      requests.created.push(...incoming)
      return json(res, 200, { items: incoming })
    }

    if (method === 'DELETE') {
      const body = await readBody(req)
      const toDelete = body ?? []
      if (records.has(domain)) {
        const current = records.get(domain)
        for (const d of toDelete) {
          const idx = current.findIndex(r => r.name === d.name && r.type === d.type)
          if (idx !== -1) {
            requests.deleted.push(current[idx])
            current.splice(idx, 1)
          }
        }
      }
      res.writeHead(204)
      res.end()
      return
    }

    json(res, 405, { message: 'Method not allowed' })
  })

  return {
    seedDomain(domain) {
      if (!records.has(domain)) records.set(domain, [])
    },
    seedRecord(domain, record) {
      if (!records.has(domain)) records.set(domain, [])
      records.get(domain).push(record)
    },
    reset() {
      records = new Map()
      requests = { created: [], deleted: [] }
    },
    get state() { return requests },
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve(`http://127.0.0.1:${server.address().port}`)
        })
      })
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close(err => err ? reject(err) : resolve()))
    }
  }
}
