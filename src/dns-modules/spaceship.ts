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
    flag: 'api-key',
    name: 'Spaceship API key',
    env: 'SPACESHIP_API_KEY',
    secret: true,
    instructions: 'Create an API key at https://www.spaceship.com/account/api-management/'
  },
  {
    flag: 'api-secret',
    name: 'Spaceship API secret',
    env: 'SPACESHIP_API_SECRET',
    secret: true,
    instructions: 'Shown when creating an API key at https://www.spaceship.com/account/api-management/'
  }
]

const BASE_URL = process.env.SPACESHIP_API_URL ?? 'https://spaceship.dev/api/v1'

interface SpRecord {
  name: string
  type: string
  ttl?: number
  value: string
  priority?: number
}

async function spFetch<T>(path: string, options: RequestInit, apiKey: string, apiSecret: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
    }
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`Spaceship API error: ${data.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function fetchRecords(domain: string, apiKey: string, apiSecret: string): Promise<SpRecord[]> {
  const data = await spFetch<{ records: SpRecord[] }>(
    `/domains/${encodeURIComponent(domain)}/dns`,
    {},
    apiKey,
    apiSecret
  )
  return data.records ?? []
}

export async function resolveZone(domain: string, { 'api-key': apiKey, 'api-secret': apiSecret }: Record<string, string>): Promise<string> {
  const data = await spFetch<{ items: Array<{ domain: string }> }>('/domains?take=200', {}, apiKey, apiSecret)
  const containingZone = findContainingZone(domain, (data.items ?? []).map(d => d.domain))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

export async function listRecords(domain: string, { 'api-key': apiKey, 'api-secret': apiSecret }: Record<string, string>): Promise<DnsRecord[]> {
  const records = await fetchRecords(domain, apiKey, apiSecret)
  return records
    .filter(r => isMailDnsType(r.type))
    .map(r => ({
      type: r.type as DnsRecord['type'],
      name: r.name,
      content: r.value,
      ...(r.priority !== undefined && { priority: r.priority }),
      ...(r.ttl !== undefined && { ttl: r.ttl })
    }))
}

async function deleteRecords(domain: string, records: SpRecord[], apiKey: string, apiSecret: string): Promise<void> {
  await spFetch(
    `/domains/${encodeURIComponent(domain)}/dns`,
    {
      method: 'DELETE',
      body: JSON.stringify({ records })
    },
    apiKey,
    apiSecret
  )
}

async function createRecords(domain: string, records: SpRecord[], apiKey: string, apiSecret: string): Promise<void> {
  await spFetch(
    `/domains/${encodeURIComponent(domain)}/dns`,
    {
      method: 'PUT',
      body: JSON.stringify({ records })
    },
    apiKey,
    apiSecret
  )
}

export async function setupRecords(
  { domain, records, verificationPrefix, dryRun }: SetupRecordsOptions,
  { 'api-key': apiKey, 'api-secret': apiSecret }: Record<string, string>
): Promise<void> {
  const rawExisting = (await fetchRecords(domain, apiKey, apiSecret)).filter(r => isMailDnsType(r.type))
  log.success(`Zone found: ${domain}`)

  const toRecord = (r: SpRecord): DnsRecord => ({
    type: r.type as DnsRecord['type'],
    name: r.name,
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

  if (toCreate.length > 0) {
    const spRecords: SpRecord[] = toCreate.map(r => ({
      name: r.name,
      type: r.type,
      ttl: r.ttl ?? 300,
      value: r.content,
      ...(r.priority !== undefined && { priority: r.priority })
    }))
    await createRecords(domain, spRecords, apiKey, apiSecret)
  }

  if (toDelete.length > 0) {
    await deleteRecords(domain, toDelete, apiKey, apiSecret)
  }

  logDone(toCreate, verificationPrefix, toDelete.length)
}
