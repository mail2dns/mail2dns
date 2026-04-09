import { confirm as utilsConfirm, log } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'
import { findContainingZone } from '../utils.js'

export const inputs: InputDef[] = [
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

async function createRecord(domain: string, record: DnsRecord, token: string): Promise<DoRecord> {
  const body: Record<string, unknown> = {
    type: record.type,
    name: record.name,
    data: record.content,
    ttl: record.ttl ?? 3600
  }
  if (record.priority !== undefined) body.priority = record.priority
  const data = await doFetch<{ domain_record: DoRecord }>(`/domains/${domain}/records`, {
    method: 'POST',
    body: JSON.stringify(body)
  }, token)
  return data.domain_record
}

function findConflicts(existing: DoRecord[], records: DnsRecord[], verificationPrefix?: string): DoRecord[] {
  const conflicts: DoRecord[] = []

  for (const record of records) {
    const matches = existing.filter(e => {
      if (record.type === 'MX' && e.type === 'MX') return true

      if (record.type === 'TXT' && e.type === 'TXT') {
        if (record.content.includes('v=spf1') && e.data.includes('v=spf1')) return true
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.data.includes(verificationPrefix)) return true
        if (record.content.includes('v=DMARC1') && e.name === record.name) return true
      }

      if (record.type === 'CNAME' && (e.type === 'CNAME' || e.type === 'TXT') && e.name === record.name) return true

      return false
    })

    for (const m of matches) {
      if (!conflicts.find(c => c.id === m.id)) conflicts.push(m)
    }
  }

  return conflicts
}

function formatRecord(r: { type: string; name: string; data: string; priority?: number }): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.data}${priority}`
}

type Opts = SetupRecordsOptions & { confirm?: (q: string) => Promise<boolean> }

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun }: Opts,
  { token }: Record<string, string>
): Promise<void> {
  const confirm = confirmFn ?? utilsConfirm

  await checkDomainExists(domain, token)
  log.success(`Domain found: ${domain}`)

  const existing = await fetchRecords(domain, token)
  const conflicts = findConflicts(existing, records, verificationPrefix)

  if (conflicts.length > 0) {
    log.warn('\nThe following existing records will be removed:')
    for (const r of conflicts) log.dim(formatRecord(r))
  } else {
    log.info('\nNo conflicting records found.')
  }

  log.info('\nThe following records will be created:')
  for (const r of records) {
    log.dim(formatRecord({ type: r.type, name: r.name, data: r.content, priority: r.priority }))
  }

  if (dryRun) return

  console.log()
  const ok = await confirm('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return
  }

  if (conflicts.length > 0) {
    for (const r of conflicts) await deleteRecord(domain, r.id, token)
    log.info(`\nRemoved ${conflicts.length} conflicting record${conflicts.length !== 1 ? 's' : ''}`)
  }

  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 }

  for (const record of records) {
    await createRecord(domain, record, token)
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
  if (created.dkim) log.success('Created DKIM records')
  log.success('\nSetup complete.')
}
