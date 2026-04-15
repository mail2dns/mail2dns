import {
  log,
  logPlan,
  logDone,
  formatDnsRecord,
  findAndFilterConflicts,
  confirmProceed
} from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, RawInputDef, SetupRecordsOptions } from '../types.js'
import { findContainingZone } from '../utils.js'

export const inputs: RawInputDef[] = [
  {
    flag: 'token',
    name: 'DigitalOcean API token',
    env: 'DIGITALOCEAN_TOKEN',
    secret: true,
    instructions: 'Create a token at https://cloud.digitalocean.com/account/api/tokens with read and write scopes.'
  }
]

const BASE_URL = process.env.DIGITALOCEAN_API_URL ?? 'https://api.digitalocean.com/v2'

interface DoRecord {
  id: number
  type: string
  name: string
  data: string
  priority?: number
  ttl?: number
}

async function doFetch<T>(path: string, options: RequestInit, token: string): Promise<T> {
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
    throw new Error(`DigitalOcean API error: ${data.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function checkDomainExists(domain: string, token: string): Promise<void> {
  await doFetch<unknown>(`/domains/${domain}`, {}, token)
}

async function fetchRecords(domain: string, token: string): Promise<DoRecord[]> {
  const all: DoRecord[] = []
  let page = 1
  while (true) {
    const data = await doFetch<{ domain_records: DoRecord[]; meta: { total: number } }>(
      `/domains/${domain}/records?per_page=200&page=${page}`, {}, token
    )
    all.push(...data.domain_records)
    if (all.length >= data.meta.total) break
    page++
  }
  return all
}

export async function resolveZone(domain: string, { token }: Record<string, string>): Promise<string> {
  const data = await doFetch<{ domains: Array<{ name: string }> }>('/domains?per_page=200', {}, token)
  const containingZone = findContainingZone(domain, (data.domains ?? []).map(d => d.name))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

export async function listRecords(domain: string, { token }: Record<string, string>): Promise<DnsRecord[]> {
  const records = await fetchRecords(domain, token)
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

async function deleteRecord(domain: string, id: number, token: string): Promise<void> {
  await doFetch(`/domains/${domain}/records/${id}`, { method: 'DELETE' }, token)
}

function addTrailingDot(content: string, type: string): string {
  if(['CNAME', 'MX', 'NS'].includes(type) && !content.endsWith('.')) {
    return content + '.'
  }
  return content
}

export async function createRecord(domain: string, record: DnsRecord, token: string): Promise<DoRecord> {
  const body: Record<string, unknown> = {
    type: record.type,
    name: record.name,
    ttl: record.ttl ?? 3600
    data: addTrailingDot(record.content, record.type),
  }
  if (record.priority !== undefined) body.priority = record.priority
  const data = await doFetch<{ domain_record: DoRecord }>(`/domains/${domain}/records`, {
    method: 'POST',
    body: JSON.stringify(body)
  }, token)
  return data.domain_record
}

export async function setupRecords(
  { domain, records, verificationPrefix, dryRun }: SetupRecordsOptions,
  { token }: Record<string, string>
): Promise<void> {

  await checkDomainExists(domain, token)
  log.success(`Domain found: ${domain}`)

  const rawExisting = (await fetchRecords(domain, token)).filter(r => isMailDnsType(r.type))
  const toRecord = (r: DoRecord): DnsRecord => ({
    type: r.type as DnsRecord['type'],
    name: r.name,
    content: r.data,
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
    await createRecord(domain, record, token)
  }

  if (toDelete.length > 0) {
    for (const r of toDelete) await deleteRecord(domain, r.id, token)
  }

  logDone(toCreate, verificationPrefix, toDelete.length)
}
