import { setupRecords as cloudflareSetupRecords, inputs as cloudflareInputs } from './dns-modules/cloudflare.js'
import { setupRecords as godaddySetupRecords, inputs as godaddyInputs } from './dns-modules/godaddy.js'
import { setupRecords as netlifySetupRecords, inputs as netlifyInputs } from './dns-modules/netlify.js'
import { inputs as sesInputs, getRecords as sesGetRecords } from './email-modules/ses.js'
import migaduTemplate from './email-templates/migadu.json'
import googleworkspaceTemplate from './email-templates/googleworkspace.json'
import sesTemplate from './email-templates/ses.json'
import ms365Template from './email-templates/ms365.json'
import protonTemplate from './email-templates/proton.json'
import zohoTemplate from './email-templates/zoho.json'
import type { DnsProviderDef, EmailProviderDef } from './types.js'

export const DNS_PROVIDERS: Record<string, DnsProviderDef> = {
  cloudflare: {
    name: 'Cloudflare',
    setupRecords: cloudflareSetupRecords,
    inputs: cloudflareInputs
  },
  godaddy: {
    name: 'GoDaddy',
    setupRecords: godaddySetupRecords,
    inputs: godaddyInputs
  },
  netlify: {
    name: 'Netlify',
    setupRecords: netlifySetupRecords,
    inputs: netlifyInputs
  }
}

export const EMAIL_PROVIDERS: Record<string, EmailProviderDef> = {
  migadu: {
    name: 'Migadu',
    type: 'template',
    template: migaduTemplate
  },
  googleworkspace: {
    name: 'Google Workspace',
    type: 'template',
    template: googleworkspaceTemplate
  },
  ms365: {
    name: 'Microsoft 365',
    type: 'template',
    template: ms365Template
  },
  proton: {
    name: 'Proton Mail',
    type: 'template',
    template: protonTemplate
  },
  zoho: {
    name: 'Zoho Mail',
    type: 'template',
    template: zohoTemplate
  },
  ses: {
    name: 'Amazon SES',
    type: 'template',
    template: sesTemplate,
    auto: {
      explanation: 'For fully automated SES setup pass the option `--ses-mode=auto`. This will use the AWS CLI to obtain the configuration values (AWS CLI installed on host machine is required).',
      inputs: sesInputs,
      getRecords: sesGetRecords
    }
  }
}
