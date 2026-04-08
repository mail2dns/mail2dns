import { DNS_PROVIDERS } from '../providers.js'
import { resolveInputs } from '../utils.js'
import { validateDomain, validateEmailProvider, validateDnsProvider } from '../validate.js'
import { buildRecords, getEmailInputDefs } from '../core.js'

export async function setup(
  domain: string,
  emailProvider: string,
  dnsProvider: string,
  opts: Record<string, string | undefined>
): Promise<void> {
  validateDomain(domain)
  validateEmailProvider(emailProvider)
  validateDnsProvider(dnsProvider)

  const yes = !!opts.yes
  const dryRun = !!opts.dryRun
  const emailInputDefs = getEmailInputDefs(emailProvider)
  const emailInputs = await resolveInputs(emailInputDefs, opts, yes)
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, noMx: !!opts.noMx })

  const dnsDef = DNS_PROVIDERS[dnsProvider]
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts, yes)

  const confirm = yes ? async () => true : undefined
  await dnsDef.setupRecords({ domain, records, verificationPrefix, confirm, dryRun }, dnsInputs)
}
