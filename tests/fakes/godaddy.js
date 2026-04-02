import http from 'node:http'

export function makeServer() {
  let records = new Map()  // domain -> Map<`${type}:${name}`, record[]>
  let requests = { added: [], deleted: [] }

  function key(type, name) { return `${type}:${name}` }

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

    const domainRecordsPath = path.match(/^\/v1\/domains\/([^/]+)\/records$/)
    const typeNamePath = path.match(/^\/v1\/domains\/([^/]+)\/records\/([^/]+)\/([^/]+)$/)

    // GET /v1/domains/:domain/records
    if (method === 'GET' && domainRecordsPath) {
      const domain = decodeURIComponent(domainRecordsPath[1])
      const domainRecords = records.get(domain) ?? new Map()
      const all = [...domainRecords.values()].flat()
      return json(res, 200, all)
    }

    // PATCH /v1/domains/:domain/records  (add records)
    if (method === 'PATCH' && domainRecordsPath) {
      const domain = decodeURIComponent(domainRecordsPath[1])
      const body = await readBody(req)
      if (!records.has(domain)) records.set(domain, new Map())
      const domainRecords = records.get(domain)
      for (const record of body) {
        const k = key(record.type, record.name)
        if (!domainRecords.has(k)) domainRecords.set(k, [])
        domainRecords.get(k).push(record)
        requests.added.push(record)
      }
      return json(res, 200, {})
    }

    // DELETE /v1/domains/:domain/records/:type/:name
    if (method === 'DELETE' && typeNamePath) {
      const domain = decodeURIComponent(typeNamePath[1])
      const type = typeNamePath[2]
      const name = decodeURIComponent(typeNamePath[3])
      const k = key(type, name)
      const domainRecords = records.get(domain)
      const removed = domainRecords?.get(k) ?? []
      domainRecords?.delete(k)
      for (const r of removed) requests.deleted.push(r)
      res.writeHead(204)
      res.end()
      return
    }

    json(res, 404, { message: 'Not found' })
  })

  return {
    seedRecord(domain, record) {
      if (!records.has(domain)) records.set(domain, new Map())
      const domainRecords = records.get(domain)
      const k = key(record.type, record.name)
      if (!domainRecords.has(k)) domainRecords.set(k, [])
      domainRecords.get(k).push(record)
    },
    reset() {
      records = new Map()
      requests = { added: [], deleted: [] }
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
