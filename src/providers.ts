import { setupRecords as cloudflareSetupRecords, listRecords as cloudflareListRecords, inputs as cloudflareInputs } from './dns-modules/cloudflare.js'
import { setupRecords as godaddySetupRecords, listRecords as godaddyListRecords, inputs as godaddyInputs } from './dns-modules/godaddy.js'
import { setupRecords as digitaloceanSetupRecords, listRecords as digitaloceanListRecords, inputs as digitaloceanInputs } from './dns-modules/digitalocean.js'
import { setupRecords as gcloudSetupRecords, listRecords as gcloudListRecords, inputs as gcloudInputs } from './dns-modules/gcloud.js'
import { setupRecords as netlifySetupRecords, listRecords as netlifyListRecords, inputs as netlifyInputs } from './dns-modules/netlify.js'
import { setupRecords as route53SetupRecords, listRecords as route53ListRecords, inputs as route53Inputs } from './dns-modules/route53.js'
import { setupRecords as vercelSetupRecords, listRecords as vercelListRecords, inputs as vercelInputs } from './dns-modules/vercel.js'
import { setupRecords as hetznerSetupRecords, listRecords as hetznerListRecords, inputs as hetznerInputs } from './dns-modules/hetzner.js'
import { setupRecords as spaceshipSetupRecords, listRecords as spaceshipListRecords, inputs as spaceshipInputs } from './dns-modules/spaceship.js'
import { setupRecords as azureSetupRecords, listRecords as azureListRecords, inputs as azureInputs } from './dns-modules/azure.js'
import { inputs as sesInputs, getRecords as sesGetRecords } from './email-modules/ses.js'
import migaduTemplate from './email-templates/migadu.json'
import googleworkspaceTemplate from './email-templates/googleworkspace.json'
import ms365Template from './email-templates/ms365.json'
import fastmailTemplate from './email-templates/fastmail.json'
import mailgunTemplate from './email-templates/mailgun.json'
import protonTemplate from './email-templates/proton.json'
import zohoTemplate from './email-templates/zoho.json'
import sendgridTemplate from './email-templates/sendgrid.json'
import resendTemplate from './email-templates/resend.json'
import postmarkTemplate from './email-templates/postmark.json'
import type { DnsProviderDef, EmailProviderDef } from './types.js'

export const DNS_PROVIDERS: Record<string, DnsProviderDef> = {
  cloudflare: {
    name: 'Cloudflare',
    setupRecords: cloudflareSetupRecords,
    listRecords: cloudflareListRecords,
    inputs: cloudflareInputs
  },
  digitalocean: {
    name: 'DigitalOcean',
    setupRecords: digitaloceanSetupRecords,
    listRecords: digitaloceanListRecords,
    inputs: digitaloceanInputs
  },
  godaddy: {
    name: 'GoDaddy',
    setupRecords: godaddySetupRecords,
    listRecords: godaddyListRecords,
    inputs: godaddyInputs
  },
  gcloud: {
    name: 'Google Cloud',
    setupRecords: gcloudSetupRecords,
    listRecords: gcloudListRecords,
    inputs: gcloudInputs
  },
  netlify: {
    name: 'Netlify',
    setupRecords: netlifySetupRecords,
    listRecords: netlifyListRecords,
    inputs: netlifyInputs
  },
  route53: {
    name: 'Amazon Route 53',
    setupRecords: route53SetupRecords,
    listRecords: route53ListRecords,
    inputs: route53Inputs
  },
  vercel: {
    name: 'Vercel',
    setupRecords: vercelSetupRecords,
    listRecords: vercelListRecords,
    inputs: vercelInputs
  },
  hetzner: {
    name: 'Hetzner',
    setupRecords: hetznerSetupRecords,
    listRecords: hetznerListRecords,
    inputs: hetznerInputs
  },
  spaceship: {
    name: 'Spaceship',
    setupRecords: spaceshipSetupRecords,
    listRecords: spaceshipListRecords,
    inputs: spaceshipInputs
  },
  azure: {
    name: 'Azure DNS',
    setupRecords: azureSetupRecords,
    listRecords: azureListRecords,
    inputs: azureInputs
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
  fastmail: {
    name: 'Fastmail',
    type: 'template',
    template: fastmailTemplate
  },
  mailgun: {
    name: 'Mailgun',
    type: 'template',
    template: mailgunTemplate
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
  sendgrid: {
    name: 'Twilio SendGrid',
    type: 'template',
    template: sendgridTemplate
  },
  resend: {
    name: 'Resend',
    type: 'template',
    template: resendTemplate
  },
  postmark: {
    name: 'Postmark',
    type: 'template',
    template: postmarkTemplate
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
