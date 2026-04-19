import { promises as dnsPromises } from 'node:dns'
import type { DnsRecord, EmailTemplate, VerifyRecord } from './types.js'

export function buildVerifyRecords(template: EmailTemplate, domain: string, extraVars: Record<string, string> = {}): VerifyRecord[] {
  const toScreamingSnake = (k: string) => k.replace(/([A-Z])/g, '_$1').toUpperCase()
  const domainVars: Record<string, string> = { domain, domainDashes: domain.replaceAll('.', '-'), ...extraVars }

  return template.records.map(record => {
    let name = record.name
    let content = record.value
    for (const [k, v] of Object.entries(domainVars)) {
      const ph = `{${toScreamingSnake(k)}}`
      name = name.replaceAll(ph, v)
      content = content.replaceAll(ph, v)
    }
    if (record.verifyPattern) {
      return { type: record.type as DnsRecord['type'], name, match: 'pattern' as const, pattern: new RegExp(record.verifyPattern, 'i'), display: content }
    }
    if (/\{[A-Z_]+\}/.test(content)) {
      const pattern = new RegExp(
        '^' + content.split(/\{[A-Z_]+\}/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$',
        'i'
      )
      return { type: record.type as DnsRecord['type'], name, match: 'pattern' as const, pattern, display: content }
    }
    return { type: record.type as DnsRecord['type'], name, match: 'exact' as const, content }
  })
}

type DnsResolver = Pick<typeof dnsPromises, 'resolveMx' | 'resolveTxt' | 'resolveCname' | 'resolveSrv'>

export async function checkDnsRecord(vr: VerifyRecord, fullName: string, resolver: DnsResolver = dnsPromises): Promise<string | null> {
  const find = (candidates: string[]) => candidates.find(c =>
    vr.match === 'exact' ? c.toLowerCase() === vr.content.toLowerCase() : vr.pattern.test(c)
  ) ?? null
  try {
    if (vr.type === 'MX') {
      const results = await resolver.resolveMx(fullName)
      return find(results.map(r => r.exchange))
    }
    if (vr.type === 'TXT') {
      const results = await resolver.resolveTxt(fullName)
      return find(results.map(r => r.join('')))
    }
    if (vr.type === 'CNAME') {
      const results = await resolver.resolveCname(fullName)
      return find(results)
    }
    if (vr.type === 'SRV') {
      const results = await resolver.resolveSrv(fullName)
      return find(results.map(r => `${r.priority} ${r.weight} ${r.port} ${r.name}`))
    }
  } catch {
    // ENOTFOUND / ENODATA → record doesn't exist
  }
  return null
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
    if (record.content.includes('v=DMARC1') && dnsMatch(e.name, record.name)) return true
    if (record.name.includes('._domainkey') && dnsMatch(e.name, record.name)) return true
  }
  if (record.type === 'CNAME' && (e.type === 'CNAME' || e.type === 'TXT') && e.name === record.name) return true
  return false
}

const dnsMatch = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/\.$/, '')
  return norm(a) === norm(b)
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
      dnsMatch(c.name, record.name) &&
      dnsMatch(c.content, record.content) &&
      (record.priority ? c.priority === record.priority : true)
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

export function findContainingZone(domain: string, zones: string[]): string | undefined {
  return zones
    .filter(z => domain === z || domain.endsWith(`.${z}`))
    .sort((a, b) => b.length - a.length)[0]
}

export function toFullName(name: string, domain: string): string {
  return name === '@' ? domain : `${name}.${domain}`
}

export function zonePrefix(domain: string, zone: string): string {
  if (domain === zone) return ''
  return domain.slice(0, domain.length - zone.length - 1)
}

export function applyPrefix(name: string, prefix: string): string {
  if (!prefix) return name
  return name === '@' ? prefix : `${name}.${prefix}`
}

export function removePrefix(name: string, prefix: string): string {
  if (!prefix) return name
  if (name === prefix) return '@'
  if (name.endsWith(`.${prefix}`)) return name.slice(0, -(prefix.length + 1))
  return name
}

export function normalizePrefix(name: string, prefix: string): string {
  return applyPrefix(removePrefix(name, prefix), prefix)
}
