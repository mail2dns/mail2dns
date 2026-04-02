import { confirm as utilsConfirm, log } from '../utils.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'

export const inputs: InputDef[] = [
  {
    flag: 'key',
    name: 'GoDaddy API key',
    env: 'GODADDY_API_KEY',
    instructions: 'Create API credentials at https://developer.godaddy.com/keys'
  },
  {
    flag: 'secret',
    name: 'GoDaddy API secret',
    env: 'GODADDY_API_SECRET'
  }
]

const BASE_URL = process.env.GODADDY_API_URL ?? 'https://api.godaddy.com'

interface GdRecord {
  type: string
  name: string
  data: string
  priority?: number
  ttl?: number
}

async function gdFetch<T>(path: string, options: RequestInit, key: string, secret: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `sso-key ${key}:${secret}`,
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`GoDaddy API error: ${data.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function listRecords(domain: string, key: string, secret: string): Promise<GdRecord[]> {
  return gdFetch<GdRecord[]>(`/v1/domains/${encodeURIComponent(domain)}/records`, {}, key, secret)
}

async function deleteRecords(domain: string, type: string, name: string, key: string, secret: string): Promise<void> {
  await gdFetch(
    `/v1/domains/${encodeURIComponent(domain)}/records/${type}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
    key, secret
  )
}

async function addRecords(domain: string, records: GdRecord[], key: string, secret: string): Promise<void> {
  await gdFetch(`/v1/domains/${encodeURIComponent(domain)}/records`, {
    method: 'PATCH',
    body: JSON.stringify(records)
  }, key, secret)
}

interface ConflictKey { type: string; name: string }

function findConflicts(existing: GdRecord[], records: DnsRecord[], verificationPrefix?: string): ConflictKey[] {
  const conflicts: ConflictKey[] = []

  function addConflict(type: string, name: string) {
    if (!conflicts.find(c => c.type === type && c.name === name)) {
      conflicts.push({ type, name })
    }
  }

  for (const record of records) {
    for (const e of existing) {
      if (record.type === 'MX' && e.type === 'MX') {
        addConflict(e.type, e.name)
      } else if (record.type === 'TXT' && e.type === 'TXT') {
        if (record.content.includes('v=spf1') && e.data.includes('v=spf1')) {
          addConflict(e.type, e.name)
        } else if (verificationPrefix && record.content.includes(verificationPrefix) && e.data.includes(verificationPrefix)) {
          addConflict(e.type, e.name)
        } else if (record.content.includes('v=DMARC1') && e.name === record.name) {
          addConflict(e.type, e.name)
        }
      } else if (record.name.includes('_domainkey') && (record.type === 'CNAME' || record.type === 'TXT')) {
        if ((e.type === 'CNAME' || e.type === 'TXT') && e.name === record.name) {
          addConflict(e.type, e.name)
        }
      }
    }
  }

  return conflicts
}

function toGdRecord(record: DnsRecord): GdRecord {
  const r: GdRecord = { type: record.type, name: record.name, data: record.content, ttl: record.ttl ?? 3600 }
  if (record.priority !== undefined) r.priority = record.priority
  return r
}

function formatRecord(r: { type: string; name: string; data: string; priority?: number }): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.data}${priority}`
}

type Opts = SetupRecordsOptions & { confirm?: (q: string) => Promise<boolean> }

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn }: Opts,
  { key, secret }: Record<string, string>
): Promise<void> {
  const doConfirm = confirmFn ?? utilsConfirm

  const existing = await listRecords(domain, key, secret)
  const conflictKeys = findConflicts(existing, records, verificationPrefix)
  const conflictRecords = existing.filter(e => conflictKeys.find(c => c.type === e.type && c.name === e.name))

  if (conflictRecords.length > 0) {
    log.warn('\nThe following existing records will be removed:')
    for (const r of conflictRecords) {
      log.dim(formatRecord(r))
    }
  } else {
    log.info('\nNo conflicting records found.')
  }

  log.info('\nThe following records will be created:')
  for (const r of records) {
    log.dim(formatRecord({ type: r.type, name: r.name, data: r.content, priority: r.priority }))
  }

  console.log()
  const ok = await doConfirm('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return
  }

  for (const { type, name } of conflictKeys) {
    await deleteRecords(domain, type, name, key, secret)
  }
  if (conflictKeys.length > 0) {
    log.info(`\nRemoved ${conflictKeys.length} conflicting record group${conflictKeys.length !== 1 ? 's' : ''}`)
  }

  await addRecords(domain, records.map(toGdRecord), key, secret)

  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 }
  for (const record of records) {
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
