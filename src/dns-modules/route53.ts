import { execFile } from 'child_process'
import { promisify } from 'util'
import { confirm, log } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'

const execFileAsync = promisify(execFile) as (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

export const inputs: InputDef[] = [
  {
    flag: 'awsProfile',
    name: 'AWS profile to use',
    env: 'AWS_PROFILE',
    example: 'my-profile',
    optional: true,
    value: 'profile',
  }
]

async function aws<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('aws', [...args, '--output', 'json'])
    .catch((e: { stderr?: string; message: string }) => {
      throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}\nIs the AWS CLI installed and configured?`)
    })
  return JSON.parse(stdout) as T
}

export interface R53RecordSet {
  Name: string
  Type: string
  TTL?: number
  ResourceRecords?: Array<{ Value: string }>
}

interface R53Change {
  Action: 'CREATE' | 'DELETE' | 'UPSERT'
  ResourceRecordSet: R53RecordSet
}

type AwsFn = <T>(args: string[]) => Promise<T>

async function getHostedZoneId(domain: string, awsFn: AwsFn): Promise<string> {
  const result = await awsFn<{ HostedZones: Array<{ Id: string; Name: string }> }>([
    'route53', 'list-hosted-zones-by-name', '--dns-name', `${domain}.`, '--max-items', '1'
  ])
  const zone = result.HostedZones.find(z => z.Name === `${domain}.`)
  if (!zone) throw new Error(`Hosted zone not found for domain: ${domain}`)
  return zone.Id.split('/').pop()!
}

export async function resolveZone(domain: string, { awsProfile }: Record<string, string>): Promise<string> {
  const awsFn = makeAwsCmd(awsProfile)
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.')
    const result = await awsFn<{ HostedZones: Array<{ Name: string }> }>([
      'route53', 'list-hosted-zones-by-name', '--dns-name', `${candidate}.`, '--max-items', '1'
    ])
    if (result.HostedZones.find(z => z.Name === `${candidate}.`)) return candidate
  }
  throw new Error(`No zone found for domain: ${domain}`)
}

async function fetchRecords(zoneId: string, awsFn: AwsFn): Promise<R53RecordSet[]> {
  const result = await awsFn<{ ResourceRecordSets: R53RecordSet[] }>([
    'route53', 'list-resource-record-sets', '--hosted-zone-id', zoneId
  ])
  return result.ResourceRecordSets
}

function makeAwsCmd(awsProfile: string | undefined, awsFn: AwsFn = aws): AwsFn {
  const profileArgs = awsProfile ? ['--profile', awsProfile] : []
  return (args) => awsFn([...profileArgs, ...args])
}

export function normalizeRecords(sets: R53RecordSet[], domain: string): DnsRecord[] {
  const result: DnsRecord[] = []
  for (const set of sets) {
    if (!isMailDnsType(set.Type)) continue
    const type = set.Type
    const name = normalizeName(set.Name, domain)
    const ttl = set.TTL !== undefined ? { ttl: set.TTL } : {}
    for (const rr of set.ResourceRecords ?? []) {
      if (type === 'MX') {
        const spaceIdx = rr.Value.indexOf(' ')
        const priority = parseInt(rr.Value.slice(0, spaceIdx), 10)
        const content = rr.Value.slice(spaceIdx + 1).replace(/\.$/, '')
        result.push({ type, name, content, priority, ...ttl })
      } else if (type === 'TXT') {
        result.push({ type, name, content: unquoteTxt(rr.Value), ...ttl })
      } else {
        result.push({ type, name, content: rr.Value.replace(/\.$/, ''), ...ttl })
      }
    }
  }
  return result
}

export async function listRecords(domain: string, { awsProfile }: Record<string, string>): Promise<DnsRecord[]> {
  const awsCmd = makeAwsCmd(awsProfile)
  const zoneId = await getHostedZoneId(domain, awsCmd)
  return normalizeRecords(await fetchRecords(zoneId, awsCmd), domain)
}

async function applyChanges(zoneId: string, changes: R53Change[], awsFn: AwsFn): Promise<void> {
  await awsFn<unknown>([
    'route53', 'change-resource-record-sets',
    '--hosted-zone-id', zoneId,
    '--change-batch', JSON.stringify({ Changes: changes })
  ])
}

function toFqdn(name: string, domain: string): string {
  return name === '@' ? `${domain}.` : `${name}.${domain}.`
}

function normalizeName(fqdn: string, domain: string): string {
  if (fqdn === `${domain}.`) return '@'
  if (fqdn.endsWith(`.${domain}.`)) return fqdn.slice(0, -(domain.length + 2))
  return fqdn
}

function unquoteTxt(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

function toR53Value(record: DnsRecord): string {
  if (record.type === 'MX') return `${record.priority} ${record.content}.`
  if (record.type === 'TXT') return `"${record.content}"`
  if (record.type === 'CNAME') return record.content.endsWith('.') ? record.content : `${record.content}.`
  return record.content
}

function isConflictingValue(existingValue: string, newRecord: DnsRecord, verificationPrefix?: string): boolean {
  if (newRecord.type === 'MX') return true
  const raw = unquoteTxt(existingValue)
  if (newRecord.type === 'TXT') {
    if (newRecord.content.includes('v=spf1') && raw.includes('v=spf1')) return true
    if (verificationPrefix && newRecord.content.includes(verificationPrefix) && raw.includes(verificationPrefix)) return true
    if (newRecord.content.includes('v=DMARC1') && raw.includes('v=DMARC1')) return true
  }
  if (newRecord.type === 'CNAME') return true
  return false
}

function formatRecord(name: string, type: string, value: string): string {
  const display = type === 'TXT' ? unquoteTxt(value) : value
  return `  [${type.padEnd(5)}] ${name} → ${display}`
}

type Opts = SetupRecordsOptions & {
  confirm?: (q: string) => Promise<boolean>
  aws?: <T>(args: string[]) => Promise<T>
}

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun, aws: awsFn }: Opts,
  { awsProfile }: Record<string, string>
): Promise<void> {
  const awsCmd = makeAwsCmd(awsProfile, awsFn ?? aws)
  const confirmCmd = confirmFn ?? confirm
  const zoneId = await getHostedZoneId(domain, awsCmd)
  log.success(`Hosted zone found: ${domain}`)

  const existing = await fetchRecords(zoneId, awsCmd)

  // Group incoming records by name+type
  const groups = new Map<string, DnsRecord[]>()
  for (const record of records) {
    const key = `${record.name}|${record.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(record)
  }

  const changes: R53Change[] = []
  const toRemove: string[] = []
  const toAdd: string[] = []

  for (const [key, newRecords] of groups) {
    const [name, type] = key.split('|')
    const fqdn = toFqdn(name, domain)
    const existingSet = existing.find(e => e.Name === fqdn && e.Type === type)
    const existingValues = existingSet?.ResourceRecords?.map(r => r.Value) ?? []

    const retained: string[] = []
    for (const value of existingValues) {
      if (newRecords.some(r => isConflictingValue(value, r, verificationPrefix))) {
        toRemove.push(formatRecord(name, type, value))
      } else {
        retained.push(value)
      }
    }

    const newValues = newRecords.map(toR53Value)
    for (const r of newRecords) {
      toAdd.push(formatRecord(r.name, r.type, toR53Value(r)))
    }

    changes.push({
      Action: 'UPSERT',
      ResourceRecordSet: {
        Name: fqdn,
        Type: type,
        TTL: 300,
        ResourceRecords: [...retained, ...newValues].map(Value => ({ Value }))
      }
    })
  }

  if (toRemove.length > 0) {
    log.warn('\nThe following existing records will be removed:')
    for (const r of toRemove) log.dim(r)
  } else {
    log.info('\nNo conflicting records found.')
  }

  log.info('\nThe following records will be created:')
  for (const r of toAdd) log.dim(r)

  if (dryRun) return

  console.log()
  const ok = await confirmCmd('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return
  }

  await applyChanges(zoneId, changes, awsCmd)

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
  if (created.dkim) log.success('Created DKIM records')
  log.success('\nSetup complete.')
}
