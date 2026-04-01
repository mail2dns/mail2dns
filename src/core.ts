import { EMAIL_PROVIDERS } from './providers.js'
import migaduTemplate from './email-templates/migadu.json'
import googleworkspaceTemplate from './email-templates/googleworkspace.json'
import sesTemplate from './email-templates/ses.json'
import type { DnsRecord, EmailTemplate, InputDef } from './types.js'

const TEMPLATES: Record<string, EmailTemplate> = {
  migadu: migaduTemplate,
  googleworkspace: googleworkspaceTemplate,
  ses: sesTemplate
}

function readTemplate(name: string): EmailTemplate {
  const template = TEMPLATES[name]
  if (!template) throw new Error(`Unknown email template: ${name}`)
  return template
}

function buildFromTemplate(templateName: string, domain: string, emailInputs: Record<string, string>): { records: DnsRecord[]; verificationPrefix?: string } {
  const template = readTemplate(templateName)
  const toScreamingSnake = (key: string) => key.replace(/([A-Z])/g, '_$1').toUpperCase()
  const vars: Record<string, string> = { domain, ...emailInputs }
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

function templateInputDefs(templateName: string): InputDef[] {
  const template = readTemplate(templateName)
  const instructions: Record<string, string> = template.inputInstructions ?? {}
  return (template.inputs ?? []).map(input => ({ ...input, instructions: instructions[input.flag] }))
}

export function getEmailInputDefs(emailProvider: string, mode?: 'auto' | 'manual'): InputDef[] {
  const emailDef = EMAIL_PROVIDERS[emailProvider]
  if (emailDef.type === 'template') return templateInputDefs(emailProvider)
  if (emailDef.type === 'hybrid') {
    return mode === 'manual' ? templateInputDefs(emailDef.templateName) : emailDef.inputs
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

  if (emailDef.type === 'template') return buildFromTemplate(emailProvider, domain, emailInputs)

  if (emailDef.type === 'hybrid') {
    if (mode === 'manual') return buildFromTemplate(emailDef.templateName, domain, emailInputs)
    const records = await emailDef.getRecords({ domain, ...emailInputs })
    return { records, verificationPrefix: undefined }
  }

  const records = await emailDef.getRecords({ domain, ...emailInputs })
  return { records, verificationPrefix: undefined }
}
