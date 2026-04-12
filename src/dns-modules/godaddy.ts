import { confirm as utilsConfirm, log, logPlan, countCreated, logCreated, formatDnsRecord } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, RawInputDef, SetupRecordsOptions } from '../types.js'
import { findContainingZone } from '../utils.js'

export const inputs: RawInputDef[] = [
  {
    flag: 'key',
    name: 'GoDaddy API key',
    env: 'GODADDY_API_KEY',
    secret: true,
    instructions: 'Create API credentials at https://developer.godaddy.com/keys'
  },
  {
    flag: 'secret',
    name: 'GoDaddy API secret',
    env: 'GODADDY_API_SECRET',
    secret: true
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
      ...(options?.headers as Record<string, string> | undefined)
    }
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`GoDaddy API error: ${data.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function fetchRecords(domain: string, key: string, secret: string): Promise<GdRecord[]> {
  return gdFetch<GdRecord[]>(`/v1/domains/${encodeURIComponent(domain)}/records`, {}, key, secret)
}

export async function resolveZone(domain: string, { key, secret }: Record<string, string>): Promise<string> {
  const domains = await gdFetch<Array<{ domain: string }>>('/v1/domains?statuses=ACTIVE&limit=500', {}, key, secret)
  const containingZone = findContainingZone(domain, (domains ?? []).map(d => d.domain))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

export async function listRecords(domain: string, { key, secret }: Record<string, string>): Promise<DnsRecord[]> {
  const records = await fetchRecords(domain, key, secret)
  return records
    .filter(r => isMailDnsType(r.type))
    .map(r => ({
      type: r.type as DnsRecord['type'],
      name: r.name,
      content: r.data,
      ...(r.priority !== undefined && { priority: r.priority }),
      ...(r.ttl !== undefined && { ttl: r.ttl })
    }))
}

async function addRecords(domain: string, records: GdRecord[], key: string, secret: string): Promise<void> {
  await gdFetch(`/v1/domains/${encodeURIComponent(domain)}/records`, {
    method: 'PATCH',
    body: JSON.stringify(records)
  }, key, secret)
}

async function replaceRecords(domain: string, type: string, name: string, records: GdRecord[], key: string, secret: string): Promise<void> {
  await gdFetch(`/v1/domains/${encodeURIComponent(domain)}/records/${type}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(records)
  }, key, secret)
}

function isConflicting(e: GdRecord, record: DnsRecord, verificationPrefix?: string): boolean {
  if (e.type !== record.type) return false
  if (record.type === 'MX') return true
  if (record.type === 'TXT') {
    if (record.content.includes('v=spf1') && e.data.includes('v=spf1')) return true
    if (verificationPrefix && record.content.includes(verificationPrefix) && e.data.includes(verificationPrefix)) return true
    if (record.content.includes('v=DMARC1') && e.name === record.name) return true
  }
  if (record.type === 'CNAME') return true
  return false
}

function toGdRecord(record: DnsRecord): GdRecord {
  const gdMinTtl = 600
  const r: GdRecord = { type: record.type, name: record.name, data: record.content, ttl: Math.max(record.ttl ?? 3600, gdMinTtl) }
  if (record.priority !== undefined) r.priority = record.priority
  return r
}

function formatRecord(r: { type: string; name: string; data: string; priority?: number }): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.data}${priority}`
}

type Opts = SetupRecordsOptions & { confirm?: (q: string) => Promise<boolean> }

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun }: Opts,
  { key, secret }: Record<string, string>
): Promise<void> {
  const doConfirm = confirmFn ?? utilsConfirm

  const existing = await fetchRecords(domain, key, secret)

  // Group new records by type+name and determine conflicts per group
  const groups = new Map<string, DnsRecord[]>()
  for (const record of records) {
    const k = `${record.type}:${record.name}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(record)
  }

  const conflictRecords: GdRecord[] = []
  const groupPlans = [...groups.entries()].map(([k, newRecords]) => {
    const sep = k.indexOf(':')
    const type = k.slice(0, sep)
    const name = k.slice(sep + 1)
    const existingAtGroup = existing.filter(e => e.type === type && e.name === name)
    const conflicts = existingAtGroup.filter(e => newRecords.some(r => isConflicting(e, r, verificationPrefix)))
    const retained = existingAtGroup.filter(e => !newRecords.some(r => isConflicting(e, r, verificationPrefix)))
    conflictRecords.push(...conflicts)
    return { type, name, newRecords, hasConflict: conflicts.length > 0, retained }
  })

  logPlan(
    conflictRecords.map(r => formatRecord(r)),
    records.map(r => formatDnsRecord(r))
  )

  if (dryRun) return

  console.log()
  const ok = await doConfirm('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return
  }

  const toAppend: GdRecord[] = []
  for (const { type, name, newRecords, hasConflict, retained } of groupPlans) {
    if (hasConflict) {
      await replaceRecords(domain, type, name, [...retained, ...newRecords.map(toGdRecord)], key, secret)
    } else {
      toAppend.push(...newRecords.map(toGdRecord))
    }
  }
  if (toAppend.length > 0) {
    await addRecords(domain, toAppend, key, secret)
  }

  logCreated(countCreated(records, verificationPrefix))

  if (conflictRecords.length > 0) {
    log.info(`\nRemoved ${conflictRecords.length} conflicting record${conflictRecords.length !== 1 ? 's' : ''}`)
  }

  log.success('\nSetup complete.')
}
