import http from 'node:http'

export function makeServer() {
  let zones = new Map()    // zoneName -> { id, name }
  let records = new Map()  // zoneId -> Map<recordId, record>
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

    // GET /dns_zones
    if (method === 'GET' && path === '/dns_zones') {
      return json(res, 200, [...zones.values()])
    }

    const recordsPath = path.match(/^\/dns_zones\/([^/]+)\/dns_records$/)
    const recordPath = path.match(/^\/dns_zones\/([^/]+)\/dns_records\/([^/]+)$/)

    // GET /dns_zones/:zoneId/dns_records
    if (method === 'GET' && recordsPath) {
      const zoneRecords = records.get(recordsPath[1]) ?? new Map()
      return json(res, 200, [...zoneRecords.values()])
    }

    // POST /dns_zones/:zoneId/dns_records
    if (method === 'POST' && recordsPath) {
      const zoneId = recordsPath[1]
      const body = await readBody(req)
      const id = genId()
      const record = { id, ...body }
      if (!records.has(zoneId)) records.set(zoneId, new Map())
      records.get(zoneId).set(id, record)
      requests.created.push(record)
      return json(res, 201, record)
    }

    // DELETE /dns_zones/:zoneId/dns_records/:recordId
    if (method === 'DELETE' && recordPath) {
      const [, zoneId, recordId] = recordPath
      const removed = records.get(zoneId)?.get(recordId)
      records.get(zoneId)?.delete(recordId)
      if (removed) requests.deleted.push(removed)
      res.writeHead(204)
      res.end()
      return
    }

    json(res, 404, { message: 'Not found' })
  })

  return {
    seedZone(name, id) {
      zones.set(name, { id, name })
      if (!records.has(id)) records.set(id, new Map())
    },
    seedRecord(zoneId, record) {
      if (!records.has(zoneId)) records.set(zoneId, new Map())
      records.get(zoneId).set(record.id, record)
    },
    reset() {
      zones = new Map()
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
