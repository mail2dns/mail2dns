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
  example?: string
  instructions?: string
  optional?: boolean
}

export interface SetupRecordsOptions {
  domain: string
  records: DnsRecord[]
  verificationPrefix?: string
}

export interface DnsProviderDef {
  name: string
  setupRecords: (opts: SetupRecordsOptions, inputs: Record<string, string>) => Promise<void>
  inputs: InputDef[]
}

export interface TemplateEmailProviderDef {
  type: 'template'
  name: string
  template: EmailTemplate
}

export interface ModuleEmailProviderDef {
  type: 'module'
  name: string
  inputs: InputDef[]
  getRecords: (opts: { domain: string } & Record<string, string>) => Promise<DnsRecord[]>
  records?: EmailTemplateRecord[]
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
  inputs?: InputDef[]
  records: EmailTemplateRecord[]
}
