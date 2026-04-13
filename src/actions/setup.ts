import { DNS_PROVIDERS } from '../providers.js'
import {resolveInputs, assertNoInsecureFlags, setConfirm} from '../utils.js'
import { validateDomain, validateEmailProvider, validateDnsProvider } from '../validate.js'
import { buildRecords, getEmailInputDefs, zonePrefix, applyPrefix } from '../core.js'

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
  const allowInsecureFlags = !!opts.allowInsecureFlags || process.env.M2D_ALLOW_INSECURE_FLAGS === 'true'
  const emailInputDefs = getEmailInputDefs(emailProvider)
  if (!allowInsecureFlags) {
    assertNoInsecureFlags(
      [...emailInputDefs, ...DNS_PROVIDERS[dnsProvider].inputs],
      opts,
      `${process.env.M2D_BASE_URL ?? 'https://mail2dns.com'}/setup/${emailProvider}/${dnsProvider}#protecting-secrets`
    )
  }
  const emailInputs = await resolveInputs(emailInputDefs, opts, yes)
  emailInputs.dmarcPolicy = opts.dmarcPolicy as string
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, noMx: !opts.mx })

  const dnsDef = DNS_PROVIDERS[dnsProvider]
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts, yes)

  const zone = opts.zone ?? (dnsDef.resolveZone ? await dnsDef.resolveZone(domain, dnsInputs) : domain)
  const prefix = zonePrefix(domain, zone)
  const adjustedRecords = prefix ? records.map(r => ({ ...r, name: applyPrefix(r.name, prefix) })) : records

  if(yes) setConfirm(async() => true)
  await dnsDef.setupRecords({ domain: zone, records: adjustedRecords, verificationPrefix, dryRun }, dnsInputs)
}
