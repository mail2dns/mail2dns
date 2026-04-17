import { logPlan, logDone, isConflict, confirmProceed } from '../utils.js'
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

export const minTtl = 600

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
      ttl: r.ttl ?? minTtl
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

async function deleteRecords(domain: string, type: string, name: string, key: string, secret: string): Promise<void> {
  await gdFetch(`/v1/domains/${encodeURIComponent(domain)}/records/${type}/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  }, key, secret)
}

function toRecord(e: GdRecord): DnsRecord {
  return {
    type: e.type as DnsRecord['type'],
    name: e.name,
    content: e.data,
    ...(e.priority !== undefined && { priority: e.priority })
  }
}

function toGdRecord(record: DnsRecord): GdRecord {
  const r: GdRecord = { type: record.type, name: record.name, data: record.content, ttl: Math.max(record.ttl ?? minTtl, minTtl) }
  if (record.priority !== undefined) r.priority = record.priority
  return r
}

function formatRecord(r: { type: string; name: string; data: string; priority?: number }): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.data}${priority}`
}

export async function setupRecords(
  { domain, records, verificationPrefix, dryRun }: SetupRecordsOptions,
  { key, secret }: Record<string, string>
): Promise<void> {
  const existing = await fetchRecords(domain, key, secret)

  const groups = new Map<string, DnsRecord[]>()
  for (const r of records) {
    const k = `${r.type}:${r.name}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }

  const groupPlans = []
  const allRemoved: GdRecord[] = []

  for (const [keyStr, newRecords] of groups.entries()) {
    const [type, name] = keyStr.split(':')
    const existingInGroup = existing.filter(e => e.type === type && e.name === name)

    const isIdentical = newRecords.every(nr => existingInGroup.some(er => {
      return er.data === nr.content
    }))

    if (isIdentical) continue

    const conflicts = existingInGroup.filter(e => {
        return newRecords.some(nr => isConflict(toRecord(e), nr, verificationPrefix))
    })

    if (conflicts.length > 0) allRemoved.push(...existingInGroup)

    groupPlans.push({ type, name, newRecords, conflicts, existingInGroup })
  }

  logPlan(
    allRemoved.map(formatRecord),
    groupPlans.flatMap(g => g.newRecords.map(toGdRecord)).map(formatRecord)
  )

  if (!await confirmProceed(!!dryRun, groupPlans.length > 0)) return

  const toAppend: GdRecord[] = []
  for (const { type, name, newRecords, conflicts, existingInGroup } of groupPlans) {
    if (conflicts.length > 0) {
      // PUT group if there are conflicts
      await replaceRecords(domain, type, name, newRecords.map(toGdRecord), key, secret)
    } else {
      // Filter out records already present to prevent duplicates when appending
      const missing = newRecords.filter(nr =>
          !existingInGroup.some(er => er.data === nr.content && (er.priority ?? 0) === (nr.priority ?? 0))
      )
      toAppend.push(...missing.map(toGdRecord))
    }
  }

  if (toAppend.length > 0) await addRecords(domain, toAppend, key, secret)

  logDone(groupPlans.flatMap(g => g.newRecords), verificationPrefix, allRemoved.length)
}
