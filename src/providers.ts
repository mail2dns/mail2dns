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
    autoExplanation: 'For fully automated SES setup pass the option `--ses-mode=auto`. This will use the AWS CLI to obtain the configuration values (AWS CLI installed on host machine is required).',
    inputs: sesInputs,
    getRecords: sesGetRecords as HybridEmailProviderDef['getRecords']
  }
}
