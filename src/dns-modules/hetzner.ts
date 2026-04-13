import { log, logPlan, logDone, isConflict, confirmProceed } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, RawInputDef, SetupRecordsOptions } from '../types.js'
import { findContainingZone } from '../utils.js'

export const inputs: RawInputDef[] = [
  {
    flag: 'token',
    name: 'Hetzner Cloud API token',
    env: 'HCLOUD_TOKEN',
    secret: true,
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
        result.push({ type, name: rrset.name, content: r.value, ...ttl })
      } else {
        result.push({ type, name: rrset.name, content: r.value.replace(/\.$/, ''), ...ttl })
      }
    }
  }
  return result
}

export async function resolveZone(domain: string, { token }: Record<string, string>): Promise<string> {
  const data = await hzFetch<{ zones: Array<{ name: string }> }>('/zones', {}, token)
  const containingZone = findContainingZone(domain, (data.zones ?? []).map(z => z.name))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

export async function listRecords(domain: string, { token }: Record<string, string>): Promise<DnsRecord[]> {
  return normalizeRecords(await listRRSets(domain, token))
}

function recordValue(record: DnsRecord): string {
  if (record.type === 'MX') return `${record.priority ?? 10} ${record.content}`
  if (record.type === 'TXT') return `"${record.content}"`
  return record.content
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
    const match = existing.find(e =>
      normalizeRecords([e]).some(n => isConflict(n, record, verificationPrefix))
    )

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

export async function setupRecords(
  { domain, records, verificationPrefix, dryRun }: SetupRecordsOptions,
  { token }: Record<string, string>
): Promise<void> {
  const existing = await listRRSets(domain, token)
  log.success(`Zone found: ${domain}`)

  const conflicts = findConflicts(existing, records, verificationPrefix)

  logPlan(
    conflicts.map(r => formatRRSet(r)),
    records.map(r => formatRecord(r))
  )

  if(!await confirmProceed(!!dryRun, conflicts.length > 0 || records.length > 0)) {
    return
  }

  const groups = groupRecords(records)

  for (const group of groups.values()) {
    const first = group[0]
    const rrRecords = group.map(r => ({ value: recordValue(r) }))
    await createRRSet(domain, first.name, first.type, rrRecords, first.ttl ?? 300, token)
  }

  for (const r of conflicts) {
    await deleteRRSet(domain, r.name, r.type, token)
  }

  logDone(records, verificationPrefix, conflicts.length)
}
