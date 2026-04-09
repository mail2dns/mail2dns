import { confirm as utilsConfirm, log } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'

export const inputs: InputDef[] = [
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

function findConflicts(existing: SpRecord[], records: DnsRecord[], verificationPrefix?: string): SpRecord[] {
  const conflicts: SpRecord[] = []

  for (const record of records) {
    const matches = existing.filter(e => {
      if (record.type === 'MX' && e.type === 'MX') return true

      if (record.type === 'TXT' && e.type === 'TXT' && e.name === record.name) {
        if (record.content.includes('v=spf1') && e.value.includes('v=spf1')) return true
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.value.includes(verificationPrefix)) return true
        if (record.content.includes('v=DMARC1') && e.name === record.name) return true
      }

      if (record.type === 'CNAME' && (e.type === 'CNAME' || e.type === 'TXT') && e.name === record.name) return true

      return false
    })

    for (const m of matches) {
      if (!conflicts.find(c => c.name === m.name && c.type === m.type && c.value === m.value)) {
        conflicts.push(m)
      }
    }
  }

  return conflicts
}

function formatExisting(r: SpRecord): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.value}${priority}`
}

function formatRecord(r: DnsRecord): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.content}${priority}`
}

type Opts = SetupRecordsOptions & { confirm?: (q: string) => Promise<boolean> }

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun }: Opts,
  { 'api-key': apiKey, 'api-secret': apiSecret }: Record<string, string>
): Promise<void> {
  const confirm = confirmFn ?? utilsConfirm

  const existing = await fetchRecords(domain, apiKey, apiSecret)
  log.success(`Zone found: ${domain}`)

  const conflicts = findConflicts(existing, records, verificationPrefix)

  if (conflicts.length > 0) {
    log.warn('\nThe following existing records will be removed:')
    for (const r of conflicts) {
      log.dim(formatExisting(r))
    }
  } else {
    log.info('\nNo conflicting records found.')
  }

  log.info('\nThe following records will be created:')
  for (const r of records) {
    log.dim(formatRecord(r))
  }

  if (dryRun) return

  console.log()
  const ok = await confirm('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return
  }

  if (conflicts.length > 0) {
    await deleteRecords(domain, conflicts, apiKey, apiSecret)
    log.info(`\nRemoved ${conflicts.length} conflicting record${conflicts.length !== 1 ? 's' : ''}`)
  }

  const spRecords: SpRecord[] = records.map(r => ({
    name: r.name,
    type: r.type,
    ttl: r.ttl ?? 300,
    value: r.content,
    ...(r.priority !== undefined && { priority: r.priority })
  }))

  await createRecords(domain, spRecords, apiKey, apiSecret)

  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 }
  for (const record of records) {
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
  if (created.dkim) log.success('Created DKIM CNAME records')
  log.success('\nSetup complete.')
}
