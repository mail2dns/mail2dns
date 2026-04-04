import http from 'node:http'

export function makeServer() {
  let domains = new Set()
  let records = new Map()  // domain -> Map<id, record>
  let requests = { created: [], deleted: [] }
  let nextId = 1

  function genId() { return nextId++ }

  function json(res, status, body) {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(payload)
  }

  function readBody(req) {
    return new Promise(resolve => {
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

    // GET /domains/:domain
    const domainPath = path.match(/^\/domains\/([^/]+)$/)
    if (method === 'GET' && domainPath) {
      const domain = domainPath[1]
      if (!domains.has(domain)) return json(res, 404, { message: 'Domain not found' })
      return json(res, 200, { domain: { name: domain } })
    }

    // GET /domains/:domain/records
    const recordsPath = path.match(/^\/domains\/([^/]+)\/records$/)
    if (method === 'GET' && recordsPath) {
      const domain = recordsPath[1]
      const domainRecords = records.get(domain) ?? new Map()
      return json(res, 200, { domain_records: [...domainRecords.values()] })
    }

    // POST /domains/:domain/records
    if (method === 'POST' && recordsPath) {
      const domain = recordsPath[1]
      const body = await readBody(req)
      const id = genId()
      const record = { id, ...body }
      if (!records.has(domain)) records.set(domain, new Map())
      records.get(domain).set(id, record)
      requests.created.push(record)
      return json(res, 201, { domain_record: record })
    }

    // DELETE /domains/:domain/records/:id
    const recordPath = path.match(/^\/domains\/([^/]+)\/records\/(\d+)$/)
    if (method === 'DELETE' && recordPath) {
      const [, domain, id] = recordPath
      records.get(domain)?.delete(Number(id))
      requests.deleted.push(Number(id))
      return json(res, 204, null)
    }

    json(res, 404, { message: 'Not found' })
  })

  return {
    seedDomain(name) {
      domains.add(name)
      if (!records.has(name)) records.set(name, new Map())
    },
    seedRecord(domain, record) {
      if (!records.has(domain)) records.set(domain, new Map())
      records.get(domain).set(record.id, record)
    },
    reset() {
      domains = new Set()
      records = new Map()
      requests = { created: [], deleted: [] }
      nextId = 1
    },
    get state() { return requests },
    listen() {
      return new Promise(resolve => {
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
