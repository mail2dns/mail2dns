import { setupRecords as cloudflareSetupRecords, listRecords as cloudflareListRecords, resolveZone as cloudflareResolveZone, inputs as cloudflareInputs } from './dns-modules/cloudflare.js'
import { setupRecords as godaddySetupRecords, listRecords as godaddyListRecords, resolveZone as godaddyResolveZone, inputs as godaddyInputs } from './dns-modules/godaddy.js'
import { setupRecords as digitaloceanSetupRecords, listRecords as digitaloceanListRecords, resolveZone as digitaloceanResolveZone, inputs as digitaloceanInputs } from './dns-modules/digitalocean.js'
import { setupRecords as gcloudSetupRecords, listRecords as gcloudListRecords, resolveZone as gcloudResolveZone, inputs as gcloudInputs } from './dns-modules/gcloud.js'
import { setupRecords as netlifySetupRecords, listRecords as netlifyListRecords, resolveZone as netlifyResolveZone, inputs as netlifyInputs } from './dns-modules/netlify.js'
import { setupRecords as route53SetupRecords, listRecords as route53ListRecords, resolveZone as route53ResolveZone, inputs as route53Inputs } from './dns-modules/route53.js'
import { setupRecords as vercelSetupRecords, listRecords as vercelListRecords, resolveZone as vercelResolveZone, inputs as vercelInputs } from './dns-modules/vercel.js'
import { setupRecords as hetznerSetupRecords, listRecords as hetznerListRecords, resolveZone as hetznerResolveZone, inputs as hetznerInputs } from './dns-modules/hetzner.js'
import { setupRecords as spaceshipSetupRecords, listRecords as spaceshipListRecords, resolveZone as spaceshipResolveZone, inputs as spaceshipInputs } from './dns-modules/spaceship.js'
import { setupRecords as azureSetupRecords, listRecords as azureListRecords, resolveZone as azureResolveZone, inputs as azureInputs } from './dns-modules/azure.js'
import { camelToKebab } from './utils.js'
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
import type { DnsProviderDef, EmailProviderDef, InputDef, RawInputDef } from './types.js'

const zohoRegions: Record<string, { mxDomain: string; spfInclude: string }> = {
  global: { mxDomain: 'zoho.com', spfInclude: 'zoho.com' },
  eu:     { mxDomain: 'zoho.eu',  spfInclude: 'zohomail.eu' },
}

function zohoTransformInputs(inputs: Record<string, string>): Record<string, string> {
  const region = inputs.zohoRegion
  const regionData = zohoRegions[region]
  if (!regionData) throw new Error(`Unknown Zoho region: "${region}". Valid values: ${Object.keys(zohoRegions).join(', ')}`)
  return { ...inputs, mxDomain: regionData.mxDomain, spfInclude: regionData.spfInclude }
}

function withCliFlags(inputs: RawInputDef[]): InputDef[] {
  return inputs.map(i => ({ ...i, cliFlag: `--${camelToKebab(i.flag)}` }))
}

export const DNS_PROVIDERS: Record<string, DnsProviderDef> = {
  cloudflare: {
    name: 'Cloudflare',
    setupRecords: cloudflareSetupRecords,
    listRecords: cloudflareListRecords,
    resolveZone: cloudflareResolveZone,
    inputs: withCliFlags(cloudflareInputs)
  },
  digitalocean: {
    name: 'DigitalOcean',
    setupRecords: digitaloceanSetupRecords,
    listRecords: digitaloceanListRecords,
    resolveZone: digitaloceanResolveZone,
    inputs: withCliFlags(digitaloceanInputs)
  },
  godaddy: {
    name: 'GoDaddy',
    setupRecords: godaddySetupRecords,
    listRecords: godaddyListRecords,
    resolveZone: godaddyResolveZone,
    inputs: withCliFlags(godaddyInputs)
  },
  gcloud: {
    name: 'Google Cloud',
    setupRecords: gcloudSetupRecords,
    listRecords: gcloudListRecords,
    resolveZone: gcloudResolveZone,
    inputs: withCliFlags(gcloudInputs)
  },
  netlify: {
    name: 'Netlify',
    setupRecords: netlifySetupRecords,
    listRecords: netlifyListRecords,
    resolveZone: netlifyResolveZone,
    inputs: withCliFlags(netlifyInputs)
  },
  route53: {
    name: 'Amazon Route 53',
    setupRecords: route53SetupRecords,
    listRecords: route53ListRecords,
    resolveZone: route53ResolveZone,
    inputs: withCliFlags(route53Inputs)
  },
  vercel: {
    name: 'Vercel',
    setupRecords: vercelSetupRecords,
    listRecords: vercelListRecords,
    resolveZone: vercelResolveZone,
    inputs: withCliFlags(vercelInputs)
  },
  hetzner: {
    name: 'Hetzner',
    setupRecords: hetznerSetupRecords,
    listRecords: hetznerListRecords,
    resolveZone: hetznerResolveZone,
    inputs: withCliFlags(hetznerInputs)
  },
  spaceship: {
    name: 'Spaceship',
    setupRecords: spaceshipSetupRecords,
    listRecords: spaceshipListRecords,
    resolveZone: spaceshipResolveZone,
    inputs: withCliFlags(spaceshipInputs)
  },
  azure: {
    name: 'Azure DNS',
    setupRecords: azureSetupRecords,
    listRecords: azureListRecords,
    resolveZone: azureResolveZone,
    inputs: withCliFlags(azureInputs)
  }
}

export const EMAIL_PROVIDERS: Record<string, EmailProviderDef> = {
  migadu: {
    name: 'Migadu',
    type: 'template',
    template: migaduTemplate,
    inputs: withCliFlags(migaduTemplate.inputs!)
  },
  googleworkspace: {
    name: 'Google Workspace',
    type: 'template',
    template: googleworkspaceTemplate,
    inputs: withCliFlags(googleworkspaceTemplate.inputs!)
  },
  ms365: {
    name: 'Microsoft 365',
    type: 'template',
    template: ms365Template,
    inputs: withCliFlags(ms365Template.inputs!)
  },
  outlook: {
    name: 'Microsoft Outlook',
    type: 'template',
    template: ms365Template,
    inputs: withCliFlags(ms365Template.inputs!)
  },
  fastmail: {
    name: 'Fastmail',
    type: 'template',
    template: fastmailTemplate,
    inputs: []
  },
  mailgun: {
    name: 'Mailgun',
    type: 'template',
    template: mailgunTemplate,
    inputs: withCliFlags(mailgunTemplate.inputs!)
  },
  proton: {
    name: 'Proton Mail',
    type: 'template',
    template: protonTemplate,
    inputs: withCliFlags(protonTemplate.inputs!)
  },
  zoho: {
    name: 'Zoho Mail',
    type: 'template',
    template: zohoTemplate,
    inputs: withCliFlags(zohoTemplate.inputs!),
    transformInputs: zohoTransformInputs
  },
  sendgrid: {
    name: 'Twilio SendGrid',
    type: 'template',
    template: sendgridTemplate,
    inputs: withCliFlags(sendgridTemplate.inputs!)
  },
  resend: {
    name: 'Resend',
    type: 'template',
    template: resendTemplate,
    inputs: withCliFlags(resendTemplate.inputs!)
  },
  postmark: {
    name: 'Postmark',
    type: 'template',
    template: postmarkTemplate,
    inputs: withCliFlags(postmarkTemplate.inputs!)
  },
  ses: {
    name: 'Amazon SES',
    type: 'module',
    inputs: withCliFlags(sesInputs),
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
