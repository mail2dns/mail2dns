export interface DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME' | 'SRV'
  name: string
  content: string
  priority?: number
  ttl?: number
}

export interface InputDef {
  flag: string
  name: string
  env?: string
  instructions?: string
}

export interface SetupRecordsOptions {
  domain: string
  records: DnsRecord[]
  token: string
  confirm: (question: string) => Promise<boolean>
  verificationPrefix?: string
}

export interface DnsProviderDef {
  setupRecords: (opts: SetupRecordsOptions) => Promise<void>
  inputs: InputDef[]
}

export interface TemplateEmailProviderDef {
  type: 'template'
}

export interface ModuleEmailProviderDef {
  type: 'module'
  inputs: InputDef[]
  getRecords: (opts: { domain: string } & Record<string, string>) => Promise<DnsRecord[]>
}

export type EmailProviderDef = TemplateEmailProviderDef | ModuleEmailProviderDef

export interface EmailTemplateRecord {
  type: string
  name: string
  value: string
  priority?: number
}

export interface EmailTemplate {
  verificationPrefix?: string
  inputs?: Array<Omit<InputDef, 'instructions'>>
  inputInstructions?: Record<string, string>
  records: EmailTemplateRecord[]
}
