import http from 'node:http'

export function makeServer() {
  let rrsets = new Map()  // zone -> Map<`${name}/${type}`, rrset>
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

    // GET /v1/zones/:zone/rrsets
    const listPath = path.match(/^\/v1\/zones\/([^/]+)\/rrsets$/)
    if (method === 'GET' && listPath) {
      const zone = decodeURIComponent(listPath[1])
      if (!rrsets.has(zone)) {
        return json(res, 404, { error: { message: `Zone not found: ${zone}` } })
      }
      return json(res, 200, { rrsets: [...rrsets.get(zone).values()] })
    }

    // POST /v1/zones/:zone/rrsets
    const createPath = path.match(/^\/v1\/zones\/([^/]+)\/rrsets$/)
    if (method === 'POST' && createPath) {
      const zone = decodeURIComponent(createPath[1])
      const body = await readBody(req)
      const rrset = { name: body.name, type: body.type, ttl: body.ttl ?? null, records: body.records }
      if (!rrsets.has(zone)) rrsets.set(zone, new Map())
      rrsets.get(zone).set(`${body.name}/${body.type}`, rrset)
      requests.created.push(rrset)
      return json(res, 201, { rrset, action: { id: 1, command: 'create_rrset', status: 'success', progress: 100, started: new Date().toISOString(), finished: new Date().toISOString(), resources: [], error: null } })
    }

    // DELETE /v1/zones/:zone/rrsets/:name/:type
    const deletePath = path.match(/^\/v1\/zones\/([^/]+)\/rrsets\/([^/]+)\/([^/]+)$/)
    if (method === 'DELETE' && deletePath) {
      const zone = decodeURIComponent(deletePath[1])
      const name = decodeURIComponent(deletePath[2])
      const type = decodeURIComponent(deletePath[3])
      const key = `${name}/${type}`
      const removed = rrsets.get(zone)?.get(key)
      rrsets.get(zone)?.delete(key)
      if (removed) requests.deleted.push(removed)
      return json(res, 201, { action: { id: 1, command: 'delete_rrset', status: 'success', progress: 100, started: new Date().toISOString(), finished: new Date().toISOString(), resources: [], error: null } })
    }

    json(res, 404, { error: { message: 'Not found' } })
  })

  return {
    seedZone(zone) {
      if (!rrsets.has(zone)) rrsets.set(zone, new Map())
    },
    seedRRSet(zone, rrset) {
      if (!rrsets.has(zone)) rrsets.set(zone, new Map())
      rrsets.get(zone).set(`${rrset.name}/${rrset.type}`, rrset)
    },
    reset() {
      rrsets = new Map()
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
