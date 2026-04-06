import { Command } from 'commander'
import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'
import { resolveInputs, log } from './utils.js'
import { buildRecords, getEmailInputDefs } from './core.js'

const program = new Command()

program
  .name('mail2dns')
  .description('Configure DNS records for email providers')

function addEmailOptions(cmd: Command): Command {
  return cmd
    .option('--verify-txt <value>', 'email verification TXT record value')
    .option('--dkim-key <value>',   'DKIM key (Google Workspace)')
}

function addDnsOptions(cmd: Command): Command {
  return cmd
    .option('--token <token>',         'DNS provider API token (or CLOUDFLARE_API_TOKEN env)')
    .option('--aws-profile <profile>', 'AWS CLI profile to use (Route 53 and SES)')
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
    .option('--no-mx', 'skip MX records (for outbound-only use)')
)).action(async (domain: string, emailProvider: string, dnsProvider: string, opts: Record<string, string | undefined>) => {
  validateProviders(emailProvider, dnsProvider)

  const emailInputDefs = getEmailInputDefs(emailProvider)
  const emailInputs = await resolveInputs(emailInputDefs, opts)
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, noMx: !!opts.noMx })

  const dnsDef = DNS_PROVIDERS[dnsProvider]
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts)

  await dnsDef.setupRecords({ domain, records, verificationPrefix }, dnsInputs)
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
