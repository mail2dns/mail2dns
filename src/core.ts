import { promises as dnsPromises } from 'node:dns'
import { EMAIL_PROVIDERS } from './providers.js'
import type { DnsRecord, EmailTemplate, InputDef, VerifyRecord } from './types.js'

function buildFromTemplate(template: EmailTemplate, domain: string, emailInputs: Record<string, string>): { records: DnsRecord[]; verificationPrefix?: string } {
  const toScreamingSnake = (key: string) => key.replace(/([A-Z])/g, '_$1').toUpperCase()
  const vars: Record<string, string> = { domain, domainDashes: domain.replaceAll('.', '-'), ...emailInputs }
  const records: DnsRecord[] = template.records.map(record => {
    let name = record.name
    let content = record.value
    for (const [key, val] of Object.entries(vars)) {
      const placeholder = `{${toScreamingSnake(key)}}`
      name = name.replaceAll(placeholder, val)
      content = content.replaceAll(placeholder, val)
    }
    const normalized: DnsRecord = { type: record.type as DnsRecord['type'], name, content }
    if (record.priority !== undefined) normalized.priority = record.priority
    return normalized
  })
  return { records, verificationPrefix: template.verificationPrefix }
}

export function getEmailInputDefs(emailProvider: string): InputDef[] {
  return EMAIL_PROVIDERS[emailProvider].inputs
}

export async function buildRecords({ domain, emailProvider, emailInputs, noMx, verifyOnly, excludeVerifyOnly }: {
  domain: string
  emailProvider: string
  emailInputs: Record<string, string>
  noMx?: boolean
  verifyOnly?: boolean
  excludeVerifyOnly?: boolean
}): Promise<{ records: DnsRecord[]; verificationPrefix?: string }> {
  const emailDef = EMAIL_PROVIDERS[emailProvider]

  let result: { records: DnsRecord[]; verificationPrefix?: string }
  if (emailDef.type === 'template') {
    const templateRecords = verifyOnly
      ? emailDef.template.records.filter(r => r.verifyOnly)
      : excludeVerifyOnly
        ? emailDef.template.records.filter(r => !r.verifyOnly)
        : emailDef.template.records
    result = buildFromTemplate({ ...emailDef.template, records: templateRecords }, domain, emailInputs)
  } else {
    const records = await emailDef.getRecords({ domain, ...emailInputs })
    result = { records, verificationPrefix: undefined }
  }

  if (noMx) result.records = result.records.filter(r => r.type !== 'MX' || r.required)
  return result
}

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
