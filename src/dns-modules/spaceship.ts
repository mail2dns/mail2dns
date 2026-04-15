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
    instructions: 'Create an API key at https://www.spaceship.com/application/api-manager/'
  },
  {
    flag: 'api-secret',
    name: 'Spaceship API secret',
    env: 'SPACESHIP_API_SECRET',
    secret: true,
    instructions: 'Shown when creating an API key at https://www.spaceship.com/application/api-manager/'
  }
]

export const minTtl = 60

const BASE_URL = process.env.SPACESHIP_API_URL ?? 'https://spaceship.dev/api/v1'

interface SpRecord {
  name: string
  type: string
  ttl: number
}

interface SpMxRecord extends SpRecord {
  exchange: string
  preference: number
}

interface SpCnameRecord extends SpRecord {
  cname: string
}

interface SpTxtRecord extends SpRecord {
  value: string
}

type AnySpRecord = SpMxRecord | SpCnameRecord | SpTxtRecord

function dnsToSp(record: DnsRecord) {
  const base = {
    name: record.name,
    type: record.type,
  }
  if (record.type === 'MX') {
    return {
      ...base,
      exchange: record.content,
      preference: record.priority ?? 0
    } as SpMxRecord
  }
  if (record.type === 'CNAME') {
    return {
      ...base,
      cname: record.content
    } as SpCnameRecord
  }
  if (record.type === 'TXT') {
    return {
      ...base,
      value: record.content
    } as SpTxtRecord
  }
  throw new Error(`Unsupported record type: ${record.type}`)
}

function spToDns(record: AnySpRecord): DnsRecord {
  if (record.type === 'MX') {
    return {
      type: 'MX',
      name: record.name,
      content: (record as SpMxRecord).exchange,
      priority: (record as SpMxRecord).preference
    }
  }
  if (record.type === 'CNAME') {
    return {
      type: 'CNAME',
      name: record.name,
      content: (record as SpCnameRecord).cname,
    }
  }
  if (record.type === 'TXT') {
    return {
      type: 'TXT',
      name: record.name,
      content: (record as SpTxtRecord).value,
    }
  }
  throw new Error(`Unsupported record type: ${record.type}`)
}

async function spFetch<T>(path: string, options: RequestInit, apiKey: string, apiSecret: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Secret': apiSecret,
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

async function fetchRecords(domain: string, apiKey: string, apiSecret: string): Promise<AnySpRecord[]> {
  const data = await spFetch<{ items: AnySpRecord[] }>(
    `/dns/records/${domain}?take=100&skip=0`,
    {},
    apiKey,
    apiSecret
  )
  return data.items ?? []
}

export async function resolveZone(domain: string, { 'api-key': apiKey, 'api-secret': apiSecret }: Record<string, string>): Promise<string> {
  const data = await spFetch<{ items: Array<{
    name: string }> }>('/domains?take=100&skip=0', {}, apiKey, apiSecret)
  const containingZone = findContainingZone(domain, (data.items ?? []).map(d => d.name))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

export async function listRecords(domain: string, { 'api-key': apiKey, 'api-secret': apiSecret }: Record<string, string>): Promise<DnsRecord[]> {
  const records = await fetchRecords(domain, apiKey, apiSecret)
  return records
    .filter(r => isMailDnsType(r.type))
    .map(spToDns)
}

async function deleteRecords(domain: string, records: AnySpRecord[], apiKey: string, apiSecret: string): Promise<void> {
  await spFetch(
    `/dns/records/${encodeURIComponent(domain)}`,
    {
      method: 'DELETE',
      body: JSON.stringify(records)
    },
    apiKey,
    apiSecret
  )
}

async function createRecords(domain: string, records: AnySpRecord[], apiKey: string, apiSecret: string): Promise<void> {
  await spFetch(
    `/dns/records/${encodeURIComponent(domain)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ items: records })
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

  const { toDelete, conflictRecords, toCreate } = findAndFilterConflicts(rawExisting, spToDns, records, verificationPrefix)

  logPlan(
    conflictRecords.map(r => formatDnsRecord(r)),
    toCreate.map(r => formatDnsRecord(r))
  )

  if(!await confirmProceed(!!dryRun, toDelete.length > 0 || toCreate.length > 0)) {
    return
  }

  if (toCreate.length > 0) {
    const spRecords: AnySpRecord[] = toCreate.map(dnsToSp)
    await createRecords(domain, spRecords, apiKey, apiSecret)
  }

  if (toDelete.length > 0) {
    await deleteRecords(domain, toDelete, apiKey, apiSecret)
  }

  logDone(toCreate, verificationPrefix, toDelete.length)
}