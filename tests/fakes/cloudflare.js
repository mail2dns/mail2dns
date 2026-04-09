import http from 'node:http'

export function makeServer() {
  let zones = new Map()    // zoneName -> { id, name }
  let records = new Map()  // zoneId -> Map<recordId, record>
  let requests = { created: [], deleted: [] }
  let nextId = 1

  function genId() { return String(nextId++) }

  function json(res, body) {
    const payload = JSON.stringify(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(payload)
  }

  function ok(res, result) { json(res, { success: true, result }) }

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

    // GET /zones?name=X&status=active
    if (method === 'GET' && path === '/zones') {
      const name = url.searchParams.get('name')
      const zone = zones.get(name)
      return ok(res, zone ? [zone] : [])
    }

    const recordsPath = path.match(/^\/zones\/([^/]+)\/dns_records$/)
    const recordPath = path.match(/^\/zones\/([^/]+)\/dns_records\/([^/]+)$/)

    // GET /zones/:zoneId/dns_records
    if (method === 'GET' && recordsPath) {
      const allRecords = [...(records.get(recordsPath[1]) ?? new Map()).values()]
      const perPage = parseInt(url.searchParams.get('per_page') ?? '100', 10)
      const page = parseInt(url.searchParams.get('page') ?? '1', 10)
      const start = (page - 1) * perPage
      const pageRecords = allRecords.slice(start, start + perPage)
      return json(res, {
        success: true,
        result: pageRecords,
        result_info: { page, per_page: perPage, count: pageRecords.length, total_count: allRecords.length }
      })
    }

    // POST /zones/:zoneId/dns_records
    if (method === 'POST' && recordsPath) {
      const zoneId = recordsPath[1]
      const body = await readBody(req)
      const id = genId()
      const record = { id, ...body }
      if (!records.has(zoneId)) records.set(zoneId, new Map())
      records.get(zoneId).set(id, record)
      requests.created.push(record)
      return ok(res, record)
    }

    // DELETE /zones/:zoneId/dns_records/:recordId
    if (method === 'DELETE' && recordPath) {
      const [, zoneId, recordId] = recordPath
      records.get(zoneId)?.delete(recordId)
      requests.deleted.push(recordId)
      return ok(res, { id: recordId })
    }

    json(res, { success: false, errors: [{ message: 'Not found' }] })
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
