export function isMailDnsType(type: string): type is DnsRecord['type'] {
  return ['MX', 'TXT', 'CNAME', 'SRV'].includes(type)
}

export interface DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME' | 'SRV'
  name: string
  content: string
  priority?: number
  ttl?: number
}

export interface ArgumentDef {
  name: string
  description?: string
}

export interface OptionDef {
  flag: string
  cliFlag: string
  short?: string
  description: string
  default?: boolean | string
  value?: string
}

export interface RawInputDef {
  flag: string
  name: string
  env?: string
  example?: string
  instructions?: string
  optional?: boolean
  secret?: boolean
  default?: string
  value?: string
}

export interface InputDef extends RawInputDef {
  cliFlag: string
}

export interface SetupRecordsOptions {
  domain: string
  records: DnsRecord[]
  verificationPrefix?: string
  confirm?: (q: string) => Promise<boolean>
  dryRun?: boolean
}

export interface DnsProviderDef {
  name: string
  setupRecords: (opts: SetupRecordsOptions, inputs: Record<string, string>) => Promise<void>
  listRecords: (domain: string, inputs: Record<string, string>) => Promise<DnsRecord[]>
  resolveZone?: (domain: string, inputs: Record<string, string>) => Promise<string>
  inputs: InputDef[]
}

export interface TemplateEmailProviderDef {
  type: 'template'
  name: string
  template: EmailTemplate
  inputs: InputDef[]
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
  verifyPattern?: string
}

export interface EmailTemplate {
  verificationPrefix?: string
  inputs?: RawInputDef[]
  records: EmailTemplateRecord[]
}

export type VerifyRecord =
  | { type: DnsRecord['type']; name: string; match: 'exact';   content: string }
  | { type: DnsRecord['type']; name: string; match: 'pattern'; pattern: RegExp; display: string }
