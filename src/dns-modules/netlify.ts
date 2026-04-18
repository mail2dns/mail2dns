import {
  log,
  logPlan,
  logDone,
  formatDnsRecord,
  confirmProceed
} from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, RawInputDef, SetupRecordsOptions } from '../types.js'

import {findAndFilterConflicts, findContainingZone} from "../core.js";

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

export async function setupRecords(
  { domain, records, verificationPrefix, dryRun }: SetupRecordsOptions,
  { token }: Record<string, string>
): Promise<void> {
  const zoneId = await getZoneId(domain, token)
  log.success(`Zone found: ${domain}`)

  const rawExisting = (await fetchRecords(zoneId, token)).filter(r => isMailDnsType(r.type))
  const toRecord = (r: NlRecord): DnsRecord => ({
    type: r.type as DnsRecord['type'],
    name: normalizeName(r.hostname, domain),
    content: r.value,
    ...(r.priority !== undefined && { priority: r.priority })
  })
  const { toDelete, conflictRecords, toCreate } = findAndFilterConflicts(rawExisting, toRecord, records, verificationPrefix)

  logPlan(
    conflictRecords.map(r => formatDnsRecord(r)),
    toCreate.map(r => formatDnsRecord(r))
  )

  if(!await confirmProceed(!!dryRun, toDelete.length > 0 || toCreate.length > 0)) {
    return
  }

  for (const record of toCreate) {
    await createRecord(zoneId, record, domain, token)
  }

  if (toDelete.length > 0) {
    for (const r of toDelete) {
      await deleteRecord(zoneId, r.id, token)
    }
  }

  logDone(toCreate, verificationPrefix, toDelete.length)
}
