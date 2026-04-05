import { setupRecords as cloudflareSetupRecords, inputs as cloudflareInputs } from './dns-modules/cloudflare.js'
import { setupRecords as godaddySetupRecords, inputs as godaddyInputs } from './dns-modules/godaddy.js'
import { setupRecords as digitaloceanSetupRecords, inputs as digitaloceanInputs } from './dns-modules/digitalocean.js'
import { setupRecords as gcloudSetupRecords, inputs as gcloudInputs } from './dns-modules/gcloud.js'
import { setupRecords as netlifySetupRecords, inputs as netlifyInputs } from './dns-modules/netlify.js'
import { setupRecords as route53SetupRecords, inputs as route53Inputs } from './dns-modules/route53.js'
import { inputs as sesInputs, getRecords as sesGetRecords } from './email-modules/ses.js'
import migaduTemplate from './email-templates/migadu.json'
import googleworkspaceTemplate from './email-templates/googleworkspace.json'
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
  digitalocean: {
    name: 'DigitalOcean',
    setupRecords: digitaloceanSetupRecords,
    inputs: digitaloceanInputs
  },
  godaddy: {
    name: 'GoDaddy',
    setupRecords: godaddySetupRecords,
    inputs: godaddyInputs
  },
  gcloud: {
    name: 'Google Cloud',
    setupRecords: gcloudSetupRecords,
    inputs: gcloudInputs
  },
  netlify: {
    name: 'Netlify',
    setupRecords: netlifySetupRecords,
    inputs: netlifyInputs
  },
  route53: {
    name: 'Amazon Route 53',
    setupRecords: route53SetupRecords,
    inputs: route53Inputs
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
  outlook: {
    name: 'Microsoft Outlook',
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
    type: 'module',
    inputs: sesInputs,
    getRecords: sesGetRecords,
    records: [
      { type: 'TXT',   name: '_amazonses',              value: '{VERIFY_TOKEN}' },
      { type: 'MX',    name: '@',                        value: 'inbound-smtp.{REGION}.amazonaws.com', priority: 10 },
      { type: 'TXT',   name: '@',                        value: 'v=spf1 include:amazonses.com ~all' },
      { type: 'TXT',   name: '_dmarc',                   value: 'v=DMARC1; p=none;' },
      { type: 'CNAME', name: '{DKIM_TOKEN_1}._domainkey', value: '{DKIM_TOKEN_1}.dkim.amazonses.com' },
      { type: 'CNAME', name: '{DKIM_TOKEN_2}._domainkey', value: '{DKIM_TOKEN_2}.dkim.amazonses.com' },
      { type: 'CNAME', name: '{DKIM_TOKEN_3}._domainkey', value: '{DKIM_TOKEN_3}.dkim.amazonses.com' }
    ]
  }
}
