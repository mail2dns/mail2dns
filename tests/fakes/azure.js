export function makeFake() {
  let zones = []          // [{ name, resourceGroup }]
  let recordSets = new Map() // zoneName -> AzRecordSet[]
  let mutations = []      // { action, type, name, args }

  function az(args) {
    // Strip leading subscription args if present
    if (args[0] === '--subscription') args = args.slice(2)

    const [, , subcmd, type, cmd] = args  // 'network', 'dns', subcmd, type-or-verb, cmd

    if (subcmd === 'zone' && type === 'list') {
      return Promise.resolve(zones)
    }

    if (subcmd === 'record-set' && type === 'list') {
      const zone = args[args.indexOf('--zone-name') + 1]
      return Promise.resolve(recordSets.get(zone) ?? [])
    }

    // add-record, remove-record, set-record
    if (subcmd === 'record-set' && (cmd === 'add-record' || cmd === 'remove-record' || cmd === 'set-record')) {
      const zone = args[args.indexOf('--zone-name') + 1]
      const rg   = args[args.indexOf('--resource-group') + 1]
      const name = args[args.indexOf('--record-set-name') + 1]
      mutations.push({ action: cmd, type: type.toUpperCase(), name, zone, args: [...args] })

      const sets = recordSets.get(zone) ?? []
      const azType = `Microsoft.Network/dnszones/${type.toUpperCase()}`

      if (type === 'txt') {
        const value = args[args.indexOf('--value') + 1]
        let set = sets.find(s => s.name === name && s.type === azType)
        if (cmd === 'add-record') {
          if (!set) { set = { name, type: azType, ttl: 300, TXTRecords: [] }; sets.push(set) }
          set.TXTRecords.push({ value: [value] })
        } else if (cmd === 'remove-record') {
          if (set) set.TXTRecords = set.TXTRecords.filter(r => r.value.join('') !== value)
        }
      } else if (type === 'mx') {
        const preference = Number(args[args.indexOf('--preference') + 1])
        const exchange   = args[args.indexOf('--exchange') + 1]
        let set = sets.find(s => s.name === name && s.type === azType)
        if (cmd === 'add-record') {
          if (!set) { set = { name, type: azType, ttl: 300, MXRecords: [] }; sets.push(set) }
          set.MXRecords.push({ preference, exchange })
        } else if (cmd === 'remove-record') {
          if (set) set.MXRecords = set.MXRecords.filter(r => !(r.preference === preference && r.exchange === exchange))
        }
      } else if (type === 'cname') {
        const cname = args[args.indexOf('--cname') + 1]
        let set = sets.find(s => s.name === name && s.type === azType)
        if (cmd === 'set-record') {
          if (!set) { set = { name, type: azType, ttl: 300, CNAMERecord: null }; sets.push(set) }
          set.CNAMERecord = { cname }
        }
      }

      recordSets.set(zone, sets)
      return Promise.resolve({})
    }

    return Promise.reject(new Error(`Unknown az command: ${args.join(' ')}`))
  }

  return {
    az,
    seedZone(domain, resourceGroup = 'my-rg') {
      zones.push({ name: domain, resourceGroup })
      if (!recordSets.has(domain)) recordSets.set(domain, [])
    },
    seedRecordSet(domain, record) {
      if (!recordSets.has(domain)) recordSets.set(domain, [])
      recordSets.get(domain).push(record)
    },
    reset() {
      zones = []
      recordSets = new Map()
      mutations = []
    },
    get state() {
      return {
        mutations,
        added:   mutations.filter(m => m.action === 'add-record' || m.action === 'set-record'),
        removed: mutations.filter(m => m.action === 'remove-record')
      }
    }
  }
}
