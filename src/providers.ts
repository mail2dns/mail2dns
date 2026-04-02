import { setupRecords as cloudflareSetupRecords, inputs as cloudflareInputs } from './dns-modules/cloudflare.js'
import { inputs as sesInputs, getRecords as sesGetRecords } from './email-modules/ses.js'
import type { DnsProviderDef, EmailProviderDef, HybridEmailProviderDef } from './types.js'

export const DNS_PROVIDERS: Record<string, DnsProviderDef> = {
  cloudflare: {
    name: 'Cloudflare',
    setupRecords: cloudflareSetupRecords,
    inputs: cloudflareInputs
  }
}

export const EMAIL_PROVIDERS: Record<string, EmailProviderDef> = {
  migadu: {
    name: 'Migadu',
    type: 'template'
  },
  googleworkspace: {
    name: 'Google Workspace',
    type: 'template'
  },
  ses: {
    name: 'Amazon SES',
    type: 'hybrid',
    templateName: 'ses',
    inputs: sesInputs,
    getRecords: sesGetRecords as HybridEmailProviderDef['getRecords']
  }
}
