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
    name: 'Vercel API token',
    env: 'VERCEL_TOKEN',
    secret: true,
    instructions: 'Create a token at https://vercel.com/account/tokens'
  },
  {
    flag: 'team-id',
    name: 'Vercel team ID',
    env: 'VERCEL_TEAM_ID',
    instructions: 'Found in your team settings URL: vercel.com/teams/<team-slug>/settings',
    optional: true,
    value: 'id'
  }
]

const BASE_URL = process.env.VERCEL_API_URL ?? 'https://api.vercel.com'

interface VrRecord {
  id: string
  type: string
  name: string
  value: string
  ttl?: number
  mxPriority?: number
}

async function vrFetch<T>(path: string, options: RequestInit, token: string, teamId?: string): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`)
  if (teamId) url.searchParams.set('teamId', teamId)
  const res = await fetch(url.toString(), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
    }
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Vercel API error: ${data.error?.message ?? res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function fetchRecords(domain: string, token: string, teamId?: string): Promise<VrRecord[]> {
  const data = await vrFetch<{ records: VrRecord[] }>(`/v4/domains/${domain}/records`, {}, token, teamId)
  return data.records
}

export async function resolveZone(domain: string, { token, 'team-id': teamId }: Record<string, string>): Promise<string> {
  const data = await vrFetch<{ domains: Array<{ name: string }> }>('/v5/domains?limit=100', {}, token, teamId)
  const containingZone = findContainingZone(domain, (data.domains ?? []).map(d => d.name))
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

export async function listRecords(domain: string, { token, 'team-id': teamId }: Record<string, string>): Promise<DnsRecord[]> {
  const records = await fetchRecords(domain, token, teamId)
  return records
    .filter(r => isMailDnsType(r.type))
    .map(r => ({
      type: r.type as DnsRecord['type'],
      name: normalizeName(r.name),
      content: r.value,
      ...(r.mxPriority !== undefined && { priority: r.mxPriority }),
      ...(r.ttl !== undefined && { ttl: r.ttl })
    }))
}

async function deleteRecord(domain: string, recordId: string, token: string, teamId?: string): Promise<void> {
  await vrFetch(`/v2/domains/${domain}/records/${recordId}`, { method: 'DELETE' }, token, teamId)
}

async function createRecord(domain: string, record: DnsRecord, token: string, teamId?: string): Promise<VrRecord> {
  const body: Record<string, unknown> = {
    type: record.type,
    name: record.name === '@' ? '' : record.name,
    value: record.content,
    ttl: record.ttl ?? 60
  }
  if (record.priority !== undefined) {
    body.mxPriority = record.priority
  }
  return vrFetch<VrRecord>(`/v2/domains/${domain}/records`, {
    method: 'POST',
    body: JSON.stringify(body)
  }, token, teamId)
}

function normalizeName(name: string): string {
  return name === '' ? '@' : name
}

export async function setupRecords(
  { domain, records, verificationPrefix, dryRun }: SetupRecordsOptions,
  { token, 'team-id': teamId }: Record<string, string>
): Promise<void> {
  const rawExisting = (await fetchRecords(domain, token, teamId)).filter(r => isMailDnsType(r.type))
  log.success(`Zone found: ${domain}`)

  const toRecord = (r: VrRecord): DnsRecord => ({
    type: r.type as DnsRecord['type'],
    name: normalizeName(r.name),
    content: r.value,
    ...(r.mxPriority !== undefined && { priority: r.mxPriority })
  })
  const { toDelete, conflictRecords, toCreate } = findAndFilterConflicts(rawExisting, toRecord, records, verificationPrefix)

  logPlan(
    conflictRecords.map(r => formatDnsRecord(r)),
    toCreate.map(r => formatDnsRecord(r))
  )

  if(!await confirmProceed(!!dryRun, conflictRecords.length > 0 || toCreate.length > 0)) {
    return
  }

  for (const record of toCreate) {
    await createRecord(domain, record, token, teamId)
  }

  if (toDelete.length > 0) {
    for (const r of toDelete) {
      await deleteRecord(domain, r.id, token, teamId)
    }
  }

  logDone(toCreate, verificationPrefix, toDelete.length)
}
