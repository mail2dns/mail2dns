import http from 'node:http'

export function makeServer() {
  let records = new Map()  // domain -> Map<recordId, record>
  let requests = { created: [], deleted: [] }
  let nextId = 1

  function genId() { return String(nextId++) }

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

    // GET /v4/domains/:domain/records
    const listPath = path.match(/^\/v4\/domains\/([^/]+)\/records$/)
    if (method === 'GET' && listPath) {
      const domain = listPath[1]
      if (!records.has(domain)) {
        return json(res, 404, { error: { message: `Domain not found: ${domain}` } })
      }
      return json(res, 200, { records: [...records.get(domain).values()] })
    }

    // POST /v2/domains/:domain/records
    const createPath = path.match(/^\/v2\/domains\/([^/]+)\/records$/)
    if (method === 'POST' && createPath) {
      const domain = createPath[1]
      const body = await readBody(req)
      const id = genId()
      const record = { id, ...body }
      if (!records.has(domain)) records.set(domain, new Map())
      records.get(domain).set(id, record)
      requests.created.push(record)
      return json(res, 200, { uid: id })
    }

    // DELETE /v2/domains/:domain/records/:recordId
    const deletePath = path.match(/^\/v2\/domains\/([^/]+)\/records\/([^/]+)$/)
    if (method === 'DELETE' && deletePath) {
      const [, domain, recordId] = deletePath
      const removed = records.get(domain)?.get(recordId)
      records.get(domain)?.delete(recordId)
      if (removed) requests.deleted.push(removed)
      res.writeHead(204)
      res.end()
      return
    }

    json(res, 404, { error: { message: 'Not found' } })
  })

  return {
    seedDomain(domain) {
      if (!records.has(domain)) records.set(domain, new Map())
    },
    seedRecord(domain, record) {
      if (!records.has(domain)) records.set(domain, new Map())
      records.get(domain).set(record.id, record)
    },
    reset() {
      records = new Map()
      requests = { created: [], deleted: [] }
      nextId = 1
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
