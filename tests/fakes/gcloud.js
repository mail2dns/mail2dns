export function makeFake() {
  let zones = []          // [{ name, dnsName }]
  let recordSets = new Map() // zoneName -> GcpRecord[]
  let mutations = []      // { cmd, fqdn, type, rrdatas }

  function gcloud(args) {
    const [, subcmd, cmd] = args // 'dns', 'managed-zones'|'record-sets', 'list'|'create'|'update'

    if (subcmd === 'managed-zones' && cmd === 'list') {
      return Promise.resolve(zones)
    }

    if (subcmd === 'record-sets' && cmd === 'list') {
      const zone = args[args.indexOf('--zone') + 1]
      return Promise.resolve(recordSets.get(zone) ?? [])
    }

    if (subcmd === 'record-sets' && (cmd === 'create' || cmd === 'update')) {
      const fqdn = args[3]
      const type = args[args.indexOf('--type') + 1]
      const rrdatas = args[args.indexOf('--rrdatas') + 1].split(',')
      const ttl = Number(args[args.indexOf('--ttl') + 1])
      const zone = args[args.indexOf('--zone') + 1]

      mutations.push({ cmd, fqdn, type, rrdatas })

      const sets = recordSets.get(zone) ?? []
      const idx = sets.findIndex(s => s.name === fqdn && s.type === type)
      const record = { name: fqdn, type, ttl, rrdatas }
      if (idx >= 0) sets[idx] = record
      else sets.push(record)
      recordSets.set(zone, sets)

      return Promise.resolve(record)
    }

    return Promise.reject(new Error(`Unknown gcloud command: ${args.join(' ')}`))
  }

  return {
    gcloud,
    seedZone(name, domain) {
      zones.push({ name, dnsName: `${domain}.` })
      if (!recordSets.has(name)) recordSets.set(name, [])
    },
    seedRecordSet(zoneName, record) {
      if (!recordSets.has(zoneName)) recordSets.set(zoneName, [])
      recordSets.get(zoneName).push(record)
    },
    reset() {
      zones = []
      recordSets = new Map()
      mutations = []
    },
    get state() {
      return {
        mutations,
        created: mutations.filter(m => m.cmd === 'create'),
        updated: mutations.filter(m => m.cmd === 'update')
      }
    }
  }
}
