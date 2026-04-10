import { confirm as utilsConfirm, log } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, RawInputDef, SetupRecordsOptions } from '../types.js'
import { findContainingZone } from '../utils.js'

export const inputs: RawInputDef[] = [
  {
    flag: 'token',
    name: 'Netlify personal access token',
    env: 'NETLIFY_AUTH_TOKEN',
    secret: true,
    instructions: 'Create a token at https://app.netlify.com/user/applications#personal-access-tokens'
  }
]

const BASE_URL = process.env.NETLIFY_API_URL ?? 'https://api.netlify.com/api/v1'

interface NlRecord {
  id: string
  type: string
  hostname: string
  value: string
  priority?: number
  ttl?: number
}

async function nlFetch<T>(path: string, options: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
    }
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`Netlify API error: ${data.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function getZoneId(domain: string, token: string): Promise<string> {
  const zones = await nlFetch<Array<{ id: string; name: string }>>('/dns_zones', {}, token)
  const zone = zones.find(z => z.name === domain)
  if (!zone) {
    throw new Error(`DNS zone not found for domain: ${domain}`)
  }
  return zone.id
}

export async function resolveZone(domain: string, { token }: Record<string, string>): Promise<string> {
  const zones = await nlFetch<Array<{ name: string }>>('/dns_zones', {}, token)
  const containingZone = findContainingZone(domain, zones.map(z => z.name))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

async function fetchRecords(zoneId: string, token: string): Promise<NlRecord[]> {
  return nlFetch<NlRecord[]>(`/dns_zones/${zoneId}/dns_records`, {}, token)
}

export async function listRecords(domain: string, { token }: Record<string, string>): Promise<DnsRecord[]> {
  const zoneId = await getZoneId(domain, token)
  const records = await fetchRecords(zoneId, token)
  return records
    .filter(r => isMailDnsType(r.type))
    .map(r => ({
      type: r.type as DnsRecord['type'],
      name: normalizeName(r.hostname, domain),
      content: r.value,
      ...(r.priority !== undefined && { priority: r.priority }),
      ...(r.ttl !== undefined && { ttl: r.ttl })
    }))
}

async function deleteRecord(zoneId: string, recordId: string, token: string): Promise<void> {
  await nlFetch(`/dns_zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' }, token)
}

async function createRecord(zoneId: string, record: DnsRecord, domain: string, token: string): Promise<NlRecord> {
  const hostname = record.name === '@' ? domain : `${record.name}.${domain}`
  const body: Record<string, unknown> = {
    type: record.type,
    hostname,
    value: record.content,
    ttl: record.ttl ?? 3600
  }
  if (record.priority !== undefined) {
    body.priority = record.priority
  }
  return nlFetch<NlRecord>(`/dns_zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(body)
  }, token)
}

function normalizeName(hostname: string, domain: string): string {
  if (hostname === domain) return '@'
  if (hostname.endsWith(`.${domain}`)) return hostname.slice(0, -(domain.length + 1))
  return hostname
}

function findConflicts(existing: NlRecord[], records: DnsRecord[], domain: string, verificationPrefix?: string): NlRecord[] {
  const conflicts: NlRecord[] = []

  for (const record of records) {
    const matches = existing.filter(e => {
      const eName = normalizeName(e.hostname, domain)

      if (record.type === 'MX' && e.type === 'MX') return true

      if (record.type === 'TXT' && e.type === 'TXT') {
        if (record.content.includes('v=spf1') && e.value.includes('v=spf1')) return true
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.value.includes(verificationPrefix)) return true
        if (record.content.includes('v=DMARC1') && eName === record.name) return true
      }

      if (record.type === 'CNAME' && (e.type === 'CNAME' || e.type === 'TXT') && eName === record.name) return true

      return false
    })

    for (const m of matches) {
      if (!conflicts.find(c => c.id === m.id)) {
        conflicts.push(m)
      }
    }
  }

  return conflicts
}

function formatRecord(r: { type: string; hostname: string; value: string; priority?: number }, domain: string): string {
  const name = normalizeName(r.hostname, domain)
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${name} → ${r.value}${priority}`
}

type Opts = SetupRecordsOptions & { confirm?: (q: string) => Promise<boolean> }

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun }: Opts,
  { token }: Record<string, string>
): Promise<void> {
  const confirm = confirmFn ?? utilsConfirm
  const zoneId = await getZoneId(domain, token)
  log.success(`Zone found: ${domain}`)

  const existing = await fetchRecords(zoneId, token)
  const conflicts = findConflicts(existing, records, domain, verificationPrefix)

  if (conflicts.length > 0) {
    log.warn('\nThe following existing records will be removed:')
    for (const r of conflicts) {
      log.dim(formatRecord(r, domain))
    }
  } else {
    log.info('\nNo conflicting records found.')
  }

  log.info('\nThe following records will be created:')
  for (const r of records) {
    log.dim(formatRecord({ type: r.type, hostname: r.name, value: r.content, priority: r.priority }, domain))
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
      await deleteRecord(zoneId, r.id, token)
    }
    log.info(`\nRemoved ${conflicts.length} conflicting record${conflicts.length !== 1 ? 's' : ''}`)
  }

  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 }

  for (const record of records) {
    await createRecord(zoneId, record, domain, token)
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++
    else if (record.type === 'MX') created.mx++
    else if (record.content.includes('v=spf1')) created.spf++
    else if (record.content.includes('v=DMARC1')) created.dmarc++
    else if (record.name.includes('_domainkey') && (record.type === 'CNAME' || record.type === 'TXT')) created.dkim++
  }

  console.log()
  if (created.verification) log.success('Created TXT verification record')
  if (created.mx) log.success('Created MX records')
  if (created.spf) log.success('Created SPF record')
  if (created.dmarc) log.success('Created DMARC record')
  if (created.dkim) log.success('Created DKIM CNAME records')
  log.success('\nSetup complete.')
}
