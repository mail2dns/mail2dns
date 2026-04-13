import readline from 'readline'
import type { InputDef, DnsRecord } from './types.js'

let confirmImpl: (q: string) => Promise<boolean> = confirm

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(question)
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
}

export function setConfirm(fn: (q: string) => Promise<boolean>) {
  confirmImpl = fn
}

const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
}

export const log = {
  success: (msg: string) => console.log(c.green(msg)),
  error:   (msg: string) => console.error(c.red(msg)),
  warn:    (msg: string) => console.log(c.yellow(msg)),
  info:    (msg: string) => console.log(msg),
  dim:     (msg: string) => console.log(c.dim(msg)),
}

export function camelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)
}

export function ucfirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function askSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    let muted = false
    const origWrite = (rl as any)._writeToOutput.bind(rl)
    ;(rl as any)._writeToOutput = (s: string) => { if (!muted) origWrite(s) }
    rl.question(question, (answer: string) => {
      process.stderr.write('\n')
      rl.close()
      resolve(answer.trim())
    })
    muted = true
  })
}

export function formatDnsRecord(r: DnsRecord): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.content}${priority}`
}

export function isConflict(
  e: DnsRecord,
  record: DnsRecord,
  verificationPrefix?: string
): boolean {
  if (record.type === 'MX' && e.type === 'MX') return true
  if (record.type === 'TXT' && e.type === 'TXT') {
    if (record.content.includes('v=spf1') && e.content.includes('v=spf1')) return true
    if (verificationPrefix && record.content.includes(verificationPrefix) && e.content.includes(verificationPrefix)) return true
    if (record.content.includes('v=DMARC1') && e.name === record.name) return true
  }
  if (record.type === 'CNAME' && (e.type === 'CNAME' || e.type === 'TXT') && e.name === record.name) return true
  return false
}

export function findAndFilterConflicts<T>(
  existing: T[],
  toRecord: (t: T) => DnsRecord,
  desired: DnsRecord[],
  verificationPrefix?: string
): { toDelete: T[]; conflictRecords: DnsRecord[]; toCreate: DnsRecord[] } {
  type Entry = { raw: T; normalized: DnsRecord }
  const conflicts: Entry[] = []
  const seen = new Set<number>()

  for (const record of desired) {
    for (let i = 0; i < existing.length; i++) {
      if (!seen.has(i)) {
        const normalized = toRecord(existing[i])
        if (isConflict(normalized, record, verificationPrefix)) {
          seen.add(i)
          conflicts.push({ raw: existing[i], normalized })
        }
      }
    }
  }

  const noopIndices = new Set<number>()
  const toCreate = desired.filter(record => {
    const idx = conflicts.findIndex(({ normalized: c }, i) =>
      !noopIndices.has(i) &&
      c.type === record.type &&
      c.name === record.name &&
      c.content === record.content &&
      c.priority === record.priority
    )
    if (idx >= 0) { noopIndices.add(idx); return false }
    return true
  })

  const effective = conflicts.filter((_, i) => !noopIndices.has(i))
  return {
    toDelete: effective.map(e => e.raw),
    conflictRecords: effective.map(e => e.normalized),
    toCreate
  }
}

export function logPlan(toRemove: string[], toAdd: string[]): void {
  if (toRemove.length > 0) {
    log.error('\nConflicts detected')
    log.warn('\nThe following existing records will be removed:')
    for (const r of toRemove) log.dim(r)
  } else {
    log.info('\nNo conflicting records found.')
  }
  if(toAdd.length > 0) {
    log.info('\nThe following records will be created:')
    for (const r of toAdd) log.dim(r)
  } else {
    log.info('\nNo new records need to be created.')
  }
}

export type CreatedCounts = { verification: number; mx: number; spf: number; dmarc: number; dkim: number }

export function countCreated(records: DnsRecord[], verificationPrefix?: string): CreatedCounts {
  const counts: CreatedCounts = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 }
  for (const record of records) {
    if (verificationPrefix && record.content.includes(verificationPrefix)) counts.verification++
    else if (record.type === 'MX') counts.mx++
    else if (record.content.includes('v=spf1')) counts.spf++
    else if (record.content.includes('v=DMARC1')) counts.dmarc++
    else if (record.name.includes('_domainkey') && (record.type === 'CNAME' || record.type === 'TXT')) counts.dkim++
  }
  return counts
}

export function logCreated(counts: CreatedCounts): void {
  console.log()
  if (counts.verification) log.success('Created TXT verification record')
  if (counts.mx) log.success('Created MX records')
  if (counts.spf) log.success('Created SPF record')
  if (counts.dmarc) log.success('Created DMARC record')
  if (counts.dkim) log.success('Created DKIM CNAME records')
}

export function logRemoved(count: number): void {
  if (count > 0) log.info(`\nRemoved ${count} conflicting record${count !== 1 ? 's' : ''}`)
}

export function logSuccess(): void {
  log.success('\nSetup complete.')
}

export function logDone(created: DnsRecord[], verificationPrefix: string | undefined, removedCount: number): void {
  logCreated(countCreated(created, verificationPrefix))
  logRemoved(removedCount)
  logSuccess()
}

export async function confirmProceed(
  dryRun: boolean,
  hasChanges: boolean,
): Promise<boolean> {
  if (dryRun) {
    log.warn('\nThis is a dry run. No changes will be made.')
    return false
  }
  if (!hasChanges) {
    log.info('\nNo changes needed.')
    return false
  }
  console.log()
  const ok = await confirmImpl('Proceed? (y/N) ')
  if (!ok) {
    log.warn('Aborted.')
    return false
  }
  return true
}

export function assertNoInsecureFlags(inputs: InputDef[], argv: Record<string, string | undefined>, docsUrl?: string): void {
  for (const input of inputs) {
    if (argv[input.flag] && input.secret) {
      const envHint = input.env ? ` Use the ${input.env} environment variable instead, or provide it interactively.` : ''
      const urlHint = docsUrl ? `\nFor more information, see ${docsUrl}` : ''
      throw new Error(
        `${input.name} should not be passed via command-line flags as it will be visible in your shell history and process list.${envHint}\n` +
        `To override this, pass --allow-insecure-flags or set M2D_ALLOW_INSECURE_FLAGS=true.${urlHint}`
      )
    }
  }
}

export function findContainingZone(domain: string, zones: string[]): string | undefined {
  return zones
    .filter(z => domain === z || domain.endsWith(`.${z}`))
    .sort((a, b) => b.length - a.length)[0]
}

export async function resolveInputs(inputs: InputDef[], argv: Record<string, string | undefined>, nonInteractive = false): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const input of inputs) {
    let value = argv[input.flag]
    if (!value && input.env) value = process.env[input.env]
    if (!value && input.default) value = input.default
    if (!value) {
      if (input.optional) continue
      if (nonInteractive) throw new Error(`${input.name} is required${input.env ? ` (or set ${input.env})` : ''}`)
      if (input.instructions) log.dim(`\n${input.instructions}`)
      value = input.secret ? await askSecret(`${input.name}: `) : await ask(`${input.name}: `)
    }
    if (!value) throw new Error(`${input.name} is required`)
    result[input.flag] = value
  }
  return result
}

