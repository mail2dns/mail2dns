import { setupRecords as cloudflareSetupRecords } from './dns-modules/cloudflare.js'
import { inputs as sesInputs, getRecords as sesGetRecords } from './email-modules/ses.js'
import type { DnsProviderDef, EmailProviderDef, HybridEmailProviderDef } from './types.js'

export const DNS_PROVIDERS: Record<string, DnsProviderDef> = {
  cloudflare: {
    setupRecords: cloudflareSetupRecords,
    inputs: [
      { flag: 'token', name: 'Cloudflare API token', env: 'CLOUDFLARE_API_TOKEN' }
    ]
  }
}

export const EMAIL_PROVIDERS: Record<string, EmailProviderDef> = {
  migadu:          { type: 'template' },
  googleworkspace: { type: 'template' },
  ses: {
    type: 'hybrid',
    templateName: 'ses',
    inputs: sesInputs,
    getRecords: sesGetRecords as HybridEmailProviderDef['getRecords']
  }
}
