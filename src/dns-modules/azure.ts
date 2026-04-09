import { execFile } from 'child_process'
import { promisify } from 'util'
import { confirm as utilsConfirm, log } from '../utils.js'
import type { DnsRecord, InputDef, SetupRecordsOptions } from '../types.js'

const execFileAsync = promisify(execFile) as (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

export const inputs: InputDef[] = [
  {
    flag: 'subscription',
    name: 'Azure subscription ID to use',
    env: 'AZURE_SUBSCRIPTION_ID',
    example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    optional: true,
    instructions: 'Defaults to the active Azure subscription if not set.'
  }
]

type AzFn = <T>(args: string[]) => Promise<T>

async function az<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('az', [...args, '--output', 'json'])
    .catch((e: { stderr?: string; message: string }) => {
      throw new Error(`Azure CLI error: ${e.stderr?.trim() || e.message}\nIs the Azure CLI installed and configured? Run 'az login' to authenticate.`)
    })
  const text = stdout.trim()
  return (text ? JSON.parse(text) : null) as T
}

interface AzZone {
  name: string
  resourceGroup: string
}

export interface AzTxtRecord { value: string[] }
export interface AzMxRecord  { preference: number; exchange: string }
export interface AzCnameRecord { cname: string }

export interface AzRecordSet {
  name: string
  type: string   // e.g. "Microsoft.Network/dnszones/TXT"
  ttl: number
  txtRecords?:  AzTxtRecord[]
  mxRecords?:   AzMxRecord[]
  cnameRecord?: AzCnameRecord
}

async function getZone(domain: string, azFn: AzFn): Promise<AzZone> {
  const zones = await azFn<AzZone[]>(['network', 'dns', 'zone', 'list'])
  const zone = zones?.find(z => z.name === domain)
  if (!zone) throw new Error(`DNS zone not found for domain: ${domain}`)
  return zone
}

async function fetchRecords(rg: string, zone: string, azFn: AzFn): Promise<AzRecordSet[]> {
  return await azFn<AzRecordSet[]>([
    'network', 'dns', 'record-set', 'list',
    '--resource-group', rg,
    '--zone-name', zone
  ]) ?? []
}

function makeAzCmd(subscription: string | undefined, azFn: AzFn = az): AzFn {
  const subscriptionArgs = subscription ? ['--subscription', subscription] : []
  return (args) => azFn([...subscriptionArgs, ...args])
}

export function normalizeRecords(sets: AzRecordSet[]): DnsRecord[] {
  const result: DnsRecord[] = []
  for (const set of sets) {
    const type = azRecordType(set)
    if (type === 'TXT') {
      for (const r of set.txtRecords ?? []) {
        result.push({ type: 'TXT', name: set.name, content: txtValue(r), ttl: set.ttl })
      }
    } else if (type === 'MX') {
      for (const r of set.mxRecords ?? []) {
        result.push({ type: 'MX', name: set.name, content: r.exchange.replace(/\.$/, ''), priority: r.preference, ttl: set.ttl })
      }
    } else if (type === 'CNAME' && set.cnameRecord) {
      result.push({ type: 'CNAME', name: set.name, content: cnameValue(set.cnameRecord).replace(/\.$/, ''), ttl: set.ttl })
    }
  }
  return result
}

export async function listRecords(domain: string, { subscription }: Record<string, string>): Promise<DnsRecord[]> {
  const azCmd = makeAzCmd(subscription)
  const zone = await getZone(domain, azCmd)
  return normalizeRecords(await fetchRecords(zone.resourceGroup, domain, azCmd))
}

function azRecordType(set: AzRecordSet): string {
  return set.type.split('/').pop()!
}

// Returns flat string values for conflict-detection and display
function txtValue(r: AzTxtRecord): string { return r.value.join('') }
function mxValue(r: AzMxRecord):  string { return `${r.preference} ${r.exchange}` }
function cnameValue(r: AzCnameRecord): string { return r.cname }

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

function isConflictingValue(existing: string, newRecord: DnsRecord, verificationPrefix?: string): boolean {
  if (newRecord.type === 'MX') return true
  const raw = unquote(existing)
  if (newRecord.type === 'TXT') {
    if (newRecord.content.includes('v=spf1') && raw.includes('v=spf1')) return true
    if (verificationPrefix && newRecord.content.includes(verificationPrefix) && raw.includes(verificationPrefix)) return true
    if (newRecord.content.includes('v=DMARC1') && raw.includes('v=DMARC1')) return true
  }
  if (newRecord.type === 'CNAME') return true
  return false
}

function formatRecord(name: string, type: string, value: string): string {
  return `  [${type.padEnd(5)}] ${name} → ${value}`
}

// Build args for remove-record commands
function buildRemoveArgs(
  rg: string, zone: string, name: string, type: string,
  existing: AzRecordSet, value: string
): string[] {
  const base = ['network', 'dns', 'record-set', type.toLowerCase(), 'remove-record',
    '--resource-group', rg, '--zone-name', zone, '--record-set-name', name,
    '--keep-empty-record-set']
  if (type === 'TXT') {
    return [...base, '--value', value]
  }
  if (type === 'MX') {
    const mx = (existing.mxRecords ?? []).find(r => mxValue(r) === value)
    if (!mx) return base
    return [...base, '--preference', String(mx.preference), '--exchange', mx.exchange]
  }
  return base
}

// Build args for add-record commands
function buildAddArgs(rg: string, zone: string, record: DnsRecord): string[] {
  const name = record.name === '@' ? '@' : record.name
  if (record.type === 'TXT') {
    return ['network', 'dns', 'record-set', 'txt', 'add-record',
      '--resource-group', rg, '--zone-name', zone, '--record-set-name', name,
      '--value', record.content]
  }
  if (record.type === 'MX') {
    const exchange = record.content.endsWith('.') ? record.content : `${record.content}.`
    return ['network', 'dns', 'record-set', 'mx', 'add-record',
      '--resource-group', rg, '--zone-name', zone, '--record-set-name', name,
      '--preference', String(record.priority ?? 10), '--exchange', exchange]
  }
  if (record.type === 'CNAME') {
    const cname = record.content.endsWith('.') ? record.content : `${record.content}.`
    return ['network', 'dns', 'record-set', 'cname', 'set-record',
      '--resource-group', rg, '--zone-name', zone, '--record-set-name', name,
      '--cname', cname]
  }
  return []
}

type Opts = SetupRecordsOptions & {
  confirm?: (q: string) => Promise<boolean>
  az?: AzFn
}

export async function setupRecords(
  { domain, records, verificationPrefix, confirm: confirmFn, dryRun, az: azFn }: Opts,
  { subscription }: Record<string, string>
): Promise<void> {
  const confirmCmd = confirmFn ?? utilsConfirm
  const azCmd = makeAzCmd(subscription, azFn ?? az)

  const zone = await getZone(domain, azCmd)
  const { resourceGroup: rg } = zone
  log.success(`DNS zone found: ${domain} (resource group: ${rg})`)

  const existing = await fetchRecords(rg, domain, azCmd)

  // Group incoming records by name+type
  const groups = new Map<string, DnsRecord[]>()
  for (const record of records) {
    const key = `${record.name}|${record.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(record)
  }

  const toRemove: string[] = []
  const toAdd: string[] = []
  const removeOps: string[][] = []
  const addOps: string[][] = []

  for (const [key, newRecords] of groups) {
    const [name, type] = key.split('|')
    const existingSet = existing.find(e => e.name === name && azRecordType(e) === type)

    const existingValues: string[] = []
    if (existingSet) {
      if (type === 'TXT')   existingValues.push(...(existingSet.txtRecords ?? []).map(txtValue))
      if (type === 'MX')    existingValues.push(...(existingSet.mxRecords  ?? []).map(mxValue))
      if (type === 'CNAME' && existingSet.cnameRecord) existingValues.push(cnameValue(existingSet.cnameRecord))
    }

    for (const value of existingValues) {
      if (newRecords.some(r => isConflictingValue(value, r, verificationPrefix))) {
        toRemove.push(formatRecord(name, type, value))
        if (existingSet) {
          const args = buildRemoveArgs(rg, domain, name, type, existingSet, value)
          if (args.length) removeOps.push(args)
        }
      }
    }

    for (const record of newRecords) {
      const args = buildAddArgs(rg, domain, record)
      if (args.length) {
        addOps.push(args)
        toAdd.push(formatRecord(record.name, record.type, record.content))
      }
    }
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

  for (const args of removeOps) await azCmd(args)
  for (const args of addOps)    await azCmd(args)

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
