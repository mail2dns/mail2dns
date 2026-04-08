import { confirm as utilsConfirm, log } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'

export const inputs: InputDef[] = [
  {
    flag: 'token',
    name: 'Hetzner Cloud API token',
    env: 'HCLOUD_TOKEN',
    instructions: 'Create a token at https://console.hetzner.cloud/projects → select project → Security → API Tokens'
  }
]

const BASE_URL = process.env.HETZNER_API_URL ?? 'https://api.hetzner.cloud/v1'

export interface HzRRSet {
  name: string
  type: string
  ttl: number | null
  records: { value: string }[]
}

async function hzFetch<T>(path: string, options: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
    }
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Hetzner API error: ${data.error?.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function listRRSets(zone: string, token: string): Promise<HzRRSet[]> {
  const data = await hzFetch<{ rrsets: HzRRSet[] }>(`/zones/${encodeURIComponent(zone)}/rrsets`, {}, token)
  return data.rrsets
}

async function deleteRRSet(zone: string, name: string, type: string, token: string): Promise<void> {
  await hzFetch(
    `/zones/${encodeURIComponent(zone)}/rrsets/${encodeURIComponent(name)}/${encodeURIComponent(type)}`,
    { method: 'DELETE' },
    token
  )
}

async function createRRSet(zone: string, name: string, type: string, records: { value: string }[], ttl: number, token: string): Promise<void> {
  await hzFetch(`/zones/${encodeURIComponent(zone)}/rrsets`, {
    method: 'POST',
    body: JSON.stringify({ name, type, records, ttl })
  }, token)
}

export function normalizeRecords(rrsets: HzRRSet[]): DnsRecord[] {
  const result: DnsRecord[] = []
  for (const rrset of rrsets) {
    if (!isMailDnsType(rrset.type)) continue
    const type = rrset.type
    const ttl = rrset.ttl !== null ? { ttl: rrset.ttl } : {}
    for (const r of rrset.records) {
      if (type === 'MX') {
        const spaceIdx = r.value.indexOf(' ')
        const priority = parseInt(r.value.slice(0, spaceIdx), 10)
        const content = r.value.slice(spaceIdx + 1).replace(/\.$/, '')
        result.push({ type, name: rrset.name, content, priority, ...ttl })
      } else if (type === 'TXT') {
        const content = r.value.startsWith('"') && r.value.endsWith('"') ? r.value.slice(1, -1) : r.value
        result.push({ type, name: rrset.name, content, ...ttl })
      } else {
        result.push({ type, name: rrset.name, content: r.value.replace(/\.$/, ''), ...ttl })
      }
    }
  }
  return result
}

export async function listRecords(domain: string, { token }: Record<string, string>): Promise<DnsRecord[]> {
  return normalizeRecords(await listRRSets(domain, token))
}

function recordValue(record: DnsRecord): string {
  return record.type === 'MX'
    ? `${record.priority ?? 10} ${record.content}`
    : record.content
}

// Group DnsRecords by (name, type) for RRSet-based creation
function groupRecords(records: DnsRecord[]): Map<string, DnsRecord[]> {
  const map = new Map<string, DnsRecord[]>()
  for (const r of records) {
    const key = `${r.name}/${r.type}`
    const group = map.get(key) ?? []
    group.push(r)
    map.set(key, group)
  }
  return map
}

function findConflicts(existing: HzRRSet[], records: DnsRecord[], verificationPrefix?: string): HzRRSet[] {
  const conflicts: HzRRSet[] = []

  for (const record of records) {
    const match = existing.find(e => {
      if (record.type === 'MX' && e.type === 'MX' && e.name === record.name) return true

      if (record.type === 'TXT' && e.type === 'TXT' && e.name === record.name) {
        if (record.content.includes('v=spf1') && e.records.some(r => r.value.includes('v=spf1'))) return true
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.records.some(r => r.value.includes(verificationPrefix))) return true
        if (record.content.includes('v=DMARC1')) return true
      }

      if (record.name.includes('_domainkey') && (record.type === 'CNAME' || record.type === 'TXT')) {
        if ((e.type === 'CNAME' || e.type === 'TXT') && e.name === record.name) return true
      }

      return false
    })

    if (match && !conflicts.find(c => c.name === match.name && c.type === match.type)) {
      conflicts.push(match)
    }
  }

  return conflicts
}

function formatRRSet(r: HzRRSet): string {
  const values = r.records.map(rec => rec.value).join(', ')
  return `  [${r.type.padEnd(5)}] ${r.name} → ${values}`
}

function formatRecord(r: DnsRecord): string {
  return `  [${r.type.padEnd(5)}] ${r.name} → ${recordValue(r)}`
}

type Opts = SetupRecordsOptions & { confirm?: (q: string) => Promise<boolean> }

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun }: Opts,
  { token }: Record<string, string>
): Promise<void> {
  const confirm = confirmFn ?? utilsConfirm

  const existing = await listRRSets(domain, token)
  log.success(`Zone found: ${domain}`)

  const conflicts = findConflicts(existing, records, verificationPrefix)

  if (conflicts.length > 0) {
    log.warn('\nThe following existing RRSets will be removed:')
    for (const r of conflicts) {
      log.dim(formatRRSet(r))
    }
  } else {
    log.info('\nNo conflicting records found.')
  }

  log.info('\nThe following records will be created:')
  for (const r of records) {
    log.dim(formatRecord(r))
  }

  if (dryRun) return

  console.log()
  const ok = await confirm('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return
  }

  if (conflicts.length > 0) {
    for (const r of conflicts) {
      await deleteRRSet(domain, r.name, r.type, token)
    }
    log.info(`\nRemoved ${conflicts.length} conflicting RRSet${conflicts.length !== 1 ? 's' : ''}`)
  }

  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 }
  const groups = groupRecords(records)

  for (const group of groups.values()) {
    const first = group[0]
    const rrRecords = group.map(r => ({ value: recordValue(r) }))
    await createRRSet(domain, first.name, first.type, rrRecords, first.ttl ?? 300, token)

    for (const record of group) {
      if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++
      else if (record.type === 'MX') created.mx++
      else if (record.content.includes('v=spf1')) created.spf++
      else if (record.content.includes('v=DMARC1')) created.dmarc++
      else if (record.name.includes('_domainkey') && (record.type === 'CNAME' || record.type === 'TXT')) created.dkim++
    }
  }

  console.log()
  if (created.verification) log.success('Created TXT verification record')
  if (created.mx) log.success('Created MX records')
  if (created.spf) log.success('Created SPF record')
  if (created.dmarc) log.success('Created DMARC record')
  if (created.dkim) log.success('Created DKIM CNAME records')
  log.success('\nSetup complete.')
}
