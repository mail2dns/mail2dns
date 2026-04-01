import { Command } from 'commander'
import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'
import { ask, confirm, resolveInputs, log } from './utils.js'
import { buildRecords, getEmailInputDefs } from './core.js'
import type { SetupRecordsOptions } from './types.js'

const program = new Command()

program
  .name('mail2dns')
  .description('Configure DNS records for email providers')

function addEmailOptions(cmd: Command): Command {
  return cmd
    .option('--verify-txt <value>',  'email verification TXT record value')
    .option('--dkim-key <value>',    'DKIM key (Google Workspace)')
    .option('--aws-region <region>', 'AWS region (SES)')
    .option('--ses-mode <mode>',     'SES setup mode: auto (AWS CLI) or manual (paste tokens)')
}

function addDnsOptions(cmd: Command): Command {
  return cmd
    .option('--token <token>', 'DNS provider API token (or CLOUDFLARE_API_TOKEN env)')
}

function validateProviders(emailProvider: string, dnsProvider: string): void {
  if (!EMAIL_PROVIDERS[emailProvider]) {
    log.error(`Unknown email provider: ${emailProvider}\nSupported: ${Object.keys(EMAIL_PROVIDERS).join(', ')}`)
    process.exit(1)
  }
  if (!DNS_PROVIDERS[dnsProvider]) {
    log.error(`Unknown DNS provider: ${dnsProvider}\nSupported: ${Object.keys(DNS_PROVIDERS).join(', ')}`)
    process.exit(1)
  }
}

addDnsOptions(addEmailOptions(
  program
    .command('setup')
    .description('Create DNS records for an email provider')
    .argument('<domain>')
    .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)
    .argument('<dns-provider>',   `(${Object.keys(DNS_PROVIDERS).join(', ')})`)
)).action(async (domain: string, emailProvider: string, dnsProvider: string, opts: Record<string, string | undefined>) => {
  validateProviders(emailProvider, dnsProvider)

  let mode: 'auto' | 'manual' | undefined
  if (EMAIL_PROVIDERS[emailProvider].type === 'hybrid') {
    if (opts.sesMode === 'auto' || opts.sesMode === 'manual') {
      mode = opts.sesMode as 'auto' | 'manual'
    } else {
      const answer = await ask('SES setup — choose mode:\n  1) Automated (uses AWS CLI to fetch DKIM tokens)\n  2) Manual (paste DKIM tokens from AWS console)\nChoice [1/2]: ')
      mode = answer === '2' ? 'manual' : 'auto'
    }
  }

  const emailInputDefs = getEmailInputDefs(emailProvider, mode)
  const emailInputs = await resolveInputs(emailInputDefs, opts)
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, mode })

  const dnsDef = DNS_PROVIDERS[dnsProvider]
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts)

  await dnsDef.setupRecords({ domain, records, confirm, verificationPrefix, ...dnsInputs } as SetupRecordsOptions)
})

addEmailOptions(
  program
    .command('preview')
    .description('Show DNS records that would be created without applying them')
    .argument('<domain>')
    .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)
).action(async (_domain: string, _emailProvider: string) => {
  log.warn('preview not yet implemented')
})

addDnsOptions(
  program
    .command('list')
    .description('Show existing DNS records for a domain')
    .argument('<domain>')
    .argument('<dns-provider>', `(${Object.keys(DNS_PROVIDERS).join(', ')})`)
).action(async (_domain: string, _dnsProvider: string) => {
  log.warn('list not yet implemented')
})

addDnsOptions(addEmailOptions(
  program
    .command('verify')
    .description('Check that expected DNS records are in place')
    .argument('<domain>')
    .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)
    .argument('<dns-provider>',   `(${Object.keys(DNS_PROVIDERS).join(', ')})`)
)).action(async (_domain: string, _emailProvider: string, _dnsProvider: string) => {
  log.warn('verify not yet implemented')
})

try {
  await program.parseAsync()
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
