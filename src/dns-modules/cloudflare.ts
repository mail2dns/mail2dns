import { log, logPlan, logDone, confirmProceed, formatDnsRecord, findAndFilterConflicts } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, RawInputDef, SetupRecordsOptions } from '../types.js'


export const inputs: RawInputDef[] = [
  {
    flag: 'token',
    name: 'Cloudflare API token',
    env: 'CLOUDFLARE_API_TOKEN',
    secret: true,
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

interface CfPagedResponse<T> extends CfResponse<T> {
  result_info?: { page: number; per_page: number; count: number; total_count: number }
}

async function cfFetch<T>(path: string, options: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
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

export async function resolveZone(domain: string, { token }: Record<string, string>): Promise<string> {
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.')
    const zones = await cfFetch<Array<{ id: string }>>(`/zones?name=${encodeURIComponent(candidate)}&status=active`, {}, token)
    if (zones?.length) return candidate
  }
  throw new Error(`No zone found for domain: ${domain}`)
}

async function listDnsRecords(zoneId: string, token: string): Promise<CfRecord[]> {
  const all: CfRecord[] = []
  let page = 1
  while (true) {
    const res = await fetch(`${BASE_URL}/zones/${zoneId}/dns_records?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    })
    const data: CfPagedResponse<CfRecord[]> = await res.json()
    if (!data.success) {
      const msg = data.errors?.[0]?.message ?? 'Unknown Cloudflare API error'
      throw new Error(`Cloudflare API error: ${msg}`)
    }
    all.push(...data.result)
    if (!data.result_info || all.length >= data.result_info.total_count) break
    page++
  }
  return all
}

async function deleteRecord(zoneId: string, recordId: string, token: string): Promise<void> {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' }, token)
}

async function createRecord(zoneId: string, record: DnsRecord, token: string): Promise<CfRecord> {
  const body: Record<string, unknown> = {
    type: record.type,
    name: record.name,
    content: record.type === 'TXT' ? `"${record.content}"` : record.content,
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

export async function listRecords(domain: string, { token }: Record<string, string>): Promise<DnsRecord[]> {
  const zoneId = await getZoneId(domain, token)
  const records = await listDnsRecords(zoneId, token)
  return records
    .filter(r => isMailDnsType(r.type))
    .map(r => ({
      type: r.type as DnsRecord['type'],
      name: normalizeName(r.name, domain),
      content: r.content,
      ...(r.priority !== undefined && { priority: r.priority })
    }))
}

export async function setupRecords({ domain, records, verificationPrefix, dryRun }: SetupRecordsOptions, { token }: Record<string, string>): Promise<void> {
  const zoneId = await getZoneId(domain, token)
  log.success(`Zone found: ${domain}`)

  const rawExisting = (await listDnsRecords(zoneId, token)).filter(r => isMailDnsType(r.type))
  const toRecord = (r: CfRecord): DnsRecord => ({
    type: r.type as DnsRecord['type'],
    name: normalizeName(r.name, domain),
    content: r.type === 'TXT' ? r.content.replace(/^"|"$/g, '') : r.content,
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
    await createRecord(zoneId, record, token)
  }

  if (toDelete.length > 0) {
    for (const r of toDelete) {
      await deleteRecord(zoneId, r.id, token)
    }
  }

  logDone(toCreate, verificationPrefix, toDelete.length)
}
