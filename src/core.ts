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
    const normalized: DnsRecord = { type: record.type as DnsRecord['type'], name, content, ttl: 1 }
    if (record.priority !== undefined) normalized.priority = record.priority
    return normalized
  })
  return { records, verificationPrefix: template.verificationPrefix }
}

export function getEmailInputDefs(emailProvider: string, mode?: 'auto' | 'manual'): InputDef[] {
  const emailDef = EMAIL_PROVIDERS[emailProvider]
  if (emailDef.type === 'template') {
    return (mode === 'auto' && emailDef.auto) ? emailDef.auto.inputs : (emailDef.template.inputs ?? [])
  }
  return emailDef.inputs
}

export async function buildRecords({ domain, emailProvider, emailInputs, mode }: {
  domain: string
  emailProvider: string
  emailInputs: Record<string, string>
  mode?: 'auto' | 'manual'
}): Promise<{ records: DnsRecord[]; verificationPrefix?: string }> {
  const emailDef = EMAIL_PROVIDERS[emailProvider]

  if (emailDef.type === 'template') {
    if (mode === 'auto' && emailDef.auto) {
      const records = await emailDef.auto.getRecords({ domain, ...emailInputs })
      return { records, verificationPrefix: undefined }
    }
    return buildFromTemplate(emailDef.template, domain, emailInputs)
  }

  const records = await emailDef.getRecords({ domain, ...emailInputs })
  return { records, verificationPrefix: undefined }
}
