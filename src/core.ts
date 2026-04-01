import { EMAIL_PROVIDERS } from './providers.js'
import migaduTemplate from './email-templates/migadu.json'
import googleworkspaceTemplate from './email-templates/googleworkspace.json'
import type { DnsRecord, EmailTemplate, InputDef } from './types.js'

const TEMPLATES: Record<string, EmailTemplate> = {
  migadu: migaduTemplate,
  googleworkspace: googleworkspaceTemplate
}

function readTemplate(name: string): EmailTemplate {
  const template = TEMPLATES[name]
  if (!template) throw new Error(`Unknown email template: ${name}`)
  return template
}

export function getEmailInputDefs(emailProvider: string): InputDef[] {
  const emailDef = EMAIL_PROVIDERS[emailProvider]
  if (emailDef.type === 'template') {
    const template = readTemplate(emailProvider)
    const instructions: Record<string, string> = template.inputInstructions ?? {}
    return (template.inputs ?? []).map(input => ({ ...input, instructions: instructions[input.flag] }))
  }
  return emailDef.inputs
}

export async function buildRecords({ domain, emailProvider, emailInputs }: {
  domain: string
  emailProvider: string
  emailInputs: Record<string, string>
}): Promise<{ records: DnsRecord[]; verificationPrefix?: string }> {
  const emailDef = EMAIL_PROVIDERS[emailProvider]

  if (emailDef.type === 'template') {
    const template = readTemplate(emailProvider)
    const toScreamingSnake = (key: string) => key.replace(/([A-Z])/g, '_$1').toUpperCase()
    const vars: Record<string, string> = { domain, ...emailInputs }
    const records: DnsRecord[] = template.records.map(record => {
      let content = record.value
      for (const [key, val] of Object.entries(vars)) {
        content = content.replaceAll(`{${toScreamingSnake(key)}}`, val)
      }
      const normalized: DnsRecord = { type: record.type as DnsRecord['type'], name: record.name, content, ttl: 1 }
      if (record.priority !== undefined) normalized.priority = record.priority
      return normalized
    })
    return { records, verificationPrefix: template.verificationPrefix }
  }

  const records = await emailDef.getRecords({ domain, ...emailInputs })
  return { records, verificationPrefix: undefined }
}
