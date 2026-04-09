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
    const normalized: DnsRecord = { type: record.type as DnsRecord['type'], name, content, ttl: 1 }
    if (record.priority !== undefined) normalized.priority = record.priority
    return normalized
  })
  return { records, verificationPrefix: template.verificationPrefix }
}

export function getEmailInputDefs(emailProvider: string): InputDef[] {
  const emailDef = EMAIL_PROVIDERS[emailProvider]
  if (emailDef.type === 'template') return emailDef.template.inputs ?? []
  return emailDef.inputs
}

export async function buildRecords({ domain, emailProvider, emailInputs, noMx }: {
  domain: string
  emailProvider: string
  emailInputs: Record<string, string>
  noMx?: boolean
}): Promise<{ records: DnsRecord[]; verificationPrefix?: string }> {
  const emailDef = EMAIL_PROVIDERS[emailProvider]

  let result: { records: DnsRecord[]; verificationPrefix?: string }
  if (emailDef.type === 'template') {
    result = buildFromTemplate(emailDef.template, domain, emailInputs)
  } else {
    const records = await emailDef.getRecords({ domain, ...emailInputs })
    result = { records, verificationPrefix: undefined }
  }

  if (noMx) result.records = result.records.filter(r => r.type !== 'MX')
  return result
}

export function buildVerifyRecords(template: EmailTemplate, domain: string): VerifyRecord[] {
  const toScreamingSnake = (k: string) => k.replace(/([A-Z])/g, '_$1').toUpperCase()
  const domainVars: Record<string, string> = { domain, domainDashes: domain.replaceAll('.', '-') }

  return template.records.map(record => {
    let name = record.name
    let content = record.value
    for (const [k, v] of Object.entries(domainVars)) {
      const ph = `{${toScreamingSnake(k)}}`
      name = name.replaceAll(ph, v)
      content = content.replaceAll(ph, v)
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

type DnsResolver = Pick<typeof dnsPromises, 'resolveMx' | 'resolveTxt' | 'resolveCname' | 'resolveSrv'>

export async function checkDnsRecord(vr: VerifyRecord, fullName: string, resolver: DnsResolver = dnsPromises): Promise<boolean> {
  const matches = (c: string) =>
    vr.match === 'exact' ? c.toLowerCase() === vr.content.toLowerCase() : vr.pattern.test(c)
  try {
    if (vr.type === 'MX') {
      const results = await resolver.resolveMx(fullName)
      return results.map(r => r.exchange).some(matches)
    }
    if (vr.type === 'TXT') {
      const results = await resolver.resolveTxt(fullName)
      return results.map(r => r.join('')).some(matches)
    }
    if (vr.type === 'CNAME') {
      const results = await resolver.resolveCname(fullName)
      return results.some(matches)
    }
    if (vr.type === 'SRV') {
      const results = await resolver.resolveSrv(fullName)
      return results.map(r => `${r.priority} ${r.weight} ${r.port} ${r.name}`).some(matches)
    }
  } catch {
    // ENOTFOUND / ENODATA → record doesn't exist
  }
  return false
}
