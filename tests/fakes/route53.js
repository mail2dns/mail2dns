export function makeFake() {
  let zones = new Map()      // domain -> { Id, Name }
  let recordSets = new Map() // zoneId -> R53RecordSet[]
  let appliedChanges = []

  function aws(args) {
    const subcommand = args[1]

    if (subcommand === 'list-hosted-zones-by-name') {
      const domain = args[args.indexOf('--dns-name') + 1].replace(/\.$/, '')
      const zone = zones.get(domain)
      return Promise.resolve({ HostedZones: zone ? [zone] : [] })
    }

    if (subcommand === 'list-resource-record-sets') {
      const zoneId = args[args.indexOf('--hosted-zone-id') + 1]
      return Promise.resolve({ ResourceRecordSets: recordSets.get(zoneId) ?? [] })
    }

    if (subcommand === 'change-resource-record-sets') {
      const zoneId = args[args.indexOf('--hosted-zone-id') + 1]
      const batch = JSON.parse(args[args.indexOf('--change-batch') + 1])
      appliedChanges.push(...batch.Changes)
      for (const change of batch.Changes) {
        const sets = recordSets.get(zoneId) ?? []
        const { Name, Type } = change.ResourceRecordSet
        const idx = sets.findIndex(s => s.Name === Name && s.Type === Type)
        if (change.Action === 'UPSERT' || change.Action === 'CREATE') {
          if (idx >= 0) sets[idx] = change.ResourceRecordSet
          else sets.push(change.ResourceRecordSet)
        } else if (change.Action === 'DELETE') {
          if (idx >= 0) sets.splice(idx, 1)
        }
        recordSets.set(zoneId, sets)
      }
      return Promise.resolve({ ChangeInfo: { Status: 'INSYNC' } })
    }

    return Promise.reject(new Error(`Unknown command: ${args.join(' ')}`))
  }

  return {
    aws,
    seedZone(domain, id) {
      zones.set(domain, { Id: `/hostedzone/${id}`, Name: `${domain}.` })
      if (!recordSets.has(id)) recordSets.set(id, [])
    },
    seedRecordSet(zoneId, recordSet) {
      if (!recordSets.has(zoneId)) recordSets.set(zoneId, [])
      recordSets.get(zoneId).push(recordSet)
    },
    reset() {
      zones = new Map()
      recordSets = new Map()
      appliedChanges = []
    },
    get state() {
      return {
        changes: appliedChanges,
        upserted: appliedChanges
          .filter(c => c.Action === 'UPSERT' || c.Action === 'CREATE')
          .map(c => c.ResourceRecordSet),
      }
    }
  }
}
