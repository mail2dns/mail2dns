import { execFile } from 'child_process'
import { promisify } from 'util'
import { confirm as utilsConfirm, log } from '../utils.js'
import { isMailDnsType } from '../types.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'
import { findContainingZone } from '../utils.js'

const execFileAsync = promisify(execFile) as (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

export const inputs: InputDef[] = [
  {
    flag: 'project',
    name: 'Google Cloud project ID to use',
    env: 'CLOUDSDK_CORE_PROJECT',
    example: 'my-project-123',
    optional: true,
    instructions: 'Defaults to the active gcloud project if not set.'
  }
]

interface GcpZone {
  name: string
  dnsName: string
}

export interface GcpRecord {
  name: string
  type: string
  ttl: number
  rrdatas: string[]
}

type GcloudFn = <T>(args: string[]) => Promise<T>

async function gcloud<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('gcloud', [...args, '--format=json'])
    .catch((e: { stderr?: string; message: string }) => {
      throw new Error(`gcloud error: ${e.stderr?.trim() || e.message}\nIs the gcloud CLI installed and configured?`)
    })
  const text = stdout.trim()
  return (text ? JSON.parse(text) : null) as T
}

async function getManagedZone(domain: string, gcloudFn: GcloudFn): Promise<string> {
  const zones = await gcloudFn<GcpZone[]>(['dns', 'managed-zones', 'list'])
  const zone = zones?.find(z => z.dnsName === `${domain}.`)
  if (!zone) throw new Error(`Managed zone not found for domain: ${domain}`)
  return zone.name
}

export async function resolveZone(domain: string, { project }: Record<string, string>): Promise<string> {
  const gcloudFn = makeGcloudCmd(project)
  const zones = await gcloudFn<GcpZone[]>(['dns', 'managed-zones', 'list'])
  const names = (zones ?? []).map(z => z.dnsName.replace(/\.$/, ''))
  const containingZone = findContainingZone(domain, names)
  if (!containingZone) throw new Error(`No zone found for domain: ${domain}`)
  return containingZone
}

async function fetchRecords(zone: string, gcloudFn: GcloudFn): Promise<GcpRecord[]> {
  return await gcloudFn<GcpRecord[]>(['dns', 'record-sets', 'list', '--zone', zone]) ?? []
}

function makeGcloudCmd(project: string | undefined, gcloudFn: GcloudFn = gcloud): GcloudFn {
  const projectArgs = project ? ['--project', project] : []
  return (args) => gcloudFn([...args, ...projectArgs])
}

export function normalizeRecords(sets: GcpRecord[], domain: string): DnsRecord[] {
  const result: DnsRecord[] = []
  for (const set of sets) {
    if (!isMailDnsType(set.type)) continue
    const type = set.type
    const name = normalizeName(set.name, domain)
    for (const rrdata of set.rrdatas) {
      if (type === 'MX') {
        const spaceIdx = rrdata.indexOf(' ')
        const priority = parseInt(rrdata.slice(0, spaceIdx), 10)
        const content = rrdata.slice(spaceIdx + 1).replace(/\.$/, '')
        result.push({ type, name, content, priority, ttl: set.ttl })
      } else if (type === 'TXT') {
        result.push({ type, name, content: unquoteTxt(rrdata), ttl: set.ttl })
      } else {
        result.push({ type, name, content: rrdata.replace(/\.$/, ''), ttl: set.ttl })
      }
    }
  }
  return result
}

export async function listRecords(domain: string, { project }: Record<string, string>): Promise<DnsRecord[]> {
  const gcloudCmd = makeGcloudCmd(project)
  const zoneName = await getManagedZone(domain, gcloudCmd)
  return normalizeRecords(await fetchRecords(zoneName, gcloudCmd), domain)
}

async function upsertRecordSet(
  fqdn: string, type: string, rrdatas: string[], zone: string, hasExisting: boolean, gcloudFn: GcloudFn
): Promise<void> {
  const cmd = hasExisting ? 'update' : 'create'
  await gcloudFn<unknown>([
    'dns', 'record-sets', cmd, fqdn,
    '--type', type,
    '--ttl', '300',
    '--rrdatas', rrdatas.join(','),
    '--zone', zone
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

function toGcpValue(record: DnsRecord): string {
  if (record.type === 'MX') {
    const host = record.content.endsWith('.') ? record.content : `${record.content}.`
    return `${record.priority} ${host}`
  }
  if (record.type === 'TXT') return `"${record.content}"`
  if (record.type === 'CNAME') return record.content.endsWith('.') ? record.content : `${record.content}.`
  return record.content
}

function unquoteTxt(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
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
  gcloud?: GcloudFn
}

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun, gcloud: gcloudFn }: Opts,
  { project }: Record<string, string>
): Promise<void> {
  const confirmCmd = confirmFn ?? utilsConfirm
  const gcloudCmd = makeGcloudCmd(project, gcloudFn ?? gcloud)

  const zoneName = await getManagedZone(domain, gcloudCmd)
  log.success(`Managed zone found: ${zoneName}`)

  const existing = await fetchRecords(zoneName, gcloudCmd)

  // Group incoming records by name+type
  const groups = new Map<string, DnsRecord[]>()
  for (const record of records) {
    const key = `${record.name}|${record.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(record)
  }

  const toRemove: string[] = []
  const toAdd: string[] = []
  const ops: Array<{ fqdn: string; type: string; rrdatas: string[]; hasExisting: boolean }> = []

  for (const [key, newRecords] of groups) {
    const [name, type] = key.split('|')
    const fqdn = toFqdn(name, domain)
    const existingSet = existing.find(e => e.name === fqdn && e.type === type)
    const existingValues = existingSet?.rrdatas ?? []

    const retained: string[] = []
    for (const value of existingValues) {
      if (newRecords.some(r => isConflictingValue(value, r, verificationPrefix))) {
        toRemove.push(formatRecord(normalizeName(fqdn, domain), type, value))
      } else {
        retained.push(value)
      }
    }

    const newValues = newRecords.map(toGcpValue)
    for (const r of newRecords) {
      toAdd.push(formatRecord(r.name, r.type, toGcpValue(r)))
    }

    ops.push({ fqdn, type, rrdatas: [...retained, ...newValues], hasExisting: !!existingSet })
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

  for (const op of ops) {
    await upsertRecordSet(op.fqdn, op.type, op.rrdatas, zoneName, op.hasExisting, gcloudCmd)
  }

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
