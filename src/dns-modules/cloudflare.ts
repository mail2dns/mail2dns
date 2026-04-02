import { confirm, log } from '../utils.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'


export const inputs: InputDef[] = [
  {
    flag: 'token',
    name: 'Cloudflare API token',
    env: 'CLOUDFLARE_API_TOKEN',
    instructions: 'Create a token at https://dash.cloudflare.com/profile/api-tokens with Zone:DNS:Edit permissions'
  }
]

const BASE_URL = process.env.CLOUDFLARE_API_URL ?? 'https://api.cloudflare.com/client/v4'

interface CfRecord {
  id: string
  type: string
  name: string
  content: string
  priority?: number
}

interface CfResponse<T> {
  success: boolean
  result: T
  errors?: Array<{ message: string }>
}

async function cfFetch<T>(path: string, options: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })
  const data: CfResponse<T> = await res.json()
  if (!data.success) {
    const msg = data.errors?.[0]?.message ?? 'Unknown Cloudflare API error'
    throw new Error(`Cloudflare API error: ${msg}`)
  }
  return data.result
}

async function getZoneId(domain: string, token: string): Promise<string> {
  const zones = await cfFetch<Array<{ id: string }>>(`/zones?name=${encodeURIComponent(domain)}&status=active`, {}, token)
  if (!zones || zones.length === 0) {
    throw new Error(`Zone not found for domain: ${domain}`)
  }
  return zones[0].id
}

async function listDnsRecords(zoneId: string, token: string): Promise<CfRecord[]> {
  return cfFetch<CfRecord[]>(`/zones/${zoneId}/dns_records?per_page=100`, {}, token)
}

async function deleteRecord(zoneId: string, recordId: string, token: string): Promise<void> {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' }, token)
}

async function createRecord(zoneId: string, record: DnsRecord, token: string): Promise<CfRecord> {
  const body: Record<string, unknown> = {
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl ?? 1
  }
  if (record.priority !== undefined) {
    body.priority = record.priority
  }
  return cfFetch<CfRecord>(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(body)
  }, token)
}

function normalizeName(name: string, domain: string): string {
  if (name === domain) return '@'
  if (name.endsWith(`.${domain}`)) return name.slice(0, -(domain.length + 1))
  return name
}

function findConflicts(existing: CfRecord[], records: DnsRecord[], domain: string, verificationPrefix?: string): CfRecord[] {
  const conflicts: CfRecord[] = []

  for (const record of records) {
    const matches = existing.filter(e => {
      const eName = normalizeName(e.name, domain)

      if (record.type === 'MX' && e.type === 'MX') return true

      if (record.type === 'TXT' && e.type === 'TXT') {
        if (record.content.includes('v=spf1') && e.content.includes('v=spf1')) return true
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.content.includes(verificationPrefix)) return true
        if (record.content.includes('v=DMARC1') && eName === record.name) return true
      }

      if (record.name.includes('_domainkey') && (record.type === 'CNAME' || record.type === 'TXT')) {
        if ((e.type === 'CNAME' || e.type === 'TXT') && eName === record.name) return true
      }

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

function formatRecord(r: { type: string; name: string; content: string; priority?: number }, domain: string): string {
  const name = normalizeName(r.name, domain)
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${name} → ${r.content}${priority}`
}

export async function setupRecords({ domain, records, verificationPrefix }: SetupRecordsOptions, { token }: Record<string, string>): Promise<void> {
  const zoneId = await getZoneId(domain, token)
  log.success(`Zone found: ${domain}`)

  const existing = await listDnsRecords(zoneId, token)
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
    log.dim(formatRecord(r, domain))
  }

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
    await createRecord(zoneId, record, token)
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
