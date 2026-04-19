import { EMAIL_PROVIDERS } from './providers.js'
import type { DnsRecord, EmailTemplate, InputDef } from './types.js'

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
    const resolvedInputs = emailDef.transformInputs ? emailDef.transformInputs(emailInputs) : emailInputs
    result = buildFromTemplate({ ...emailDef.template, records: templateRecords }, domain, resolvedInputs)
  } else {
    const records = await emailDef.getRecords({ domain, ...emailInputs })
    result = { records, verificationPrefix: undefined }
  }

  if (noMx) result.records = result.records.filter(r => r.type !== 'MX' || r.required)
  return result
}
