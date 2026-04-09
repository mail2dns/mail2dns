import { DNS_PROVIDERS } from '../providers.js'
import { resolveInputs, assertNoInsecureFlags, log, formatDnsRecord } from '../utils.js'
import { validateDomain, validateDnsProvider } from '../validate.js'
import { zonePrefix, removePrefix } from '../core.js'

export async function list(
  domain: string,
  dnsProvider: string,
  opts: Record<string, string | undefined>
): Promise<void> {
  validateDomain(domain)
  validateDnsProvider(dnsProvider)
  const allowInsecureFlags = !!opts.allowInsecureFlags || process.env.M2D_ALLOW_INSECURE_FLAGS === 'true'
  const dnsDef = DNS_PROVIDERS[dnsProvider]
  if (!allowInsecureFlags) assertNoInsecureFlags(dnsDef.inputs, opts)
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts, false)
  const zone = opts.zone ?? (dnsDef.resolveZone ? await dnsDef.resolveZone(domain, dnsInputs) : domain)
  const prefix = zonePrefix(domain, zone)
  const all = await dnsDef.listRecords(zone, dnsInputs)
  const records = prefix
    ? all.filter(r => r.name === prefix || r.name.endsWith(`.${prefix}`))
         .map(r => ({ ...r, name: removePrefix(r.name, prefix) }))
    : all
  if (records.length === 0) {
    log.warn('No DNS records found.')
    return
  }
  log.info(`\nDNS records for ${domain}${prefix ? ` (zone: ${zone})` : ''} (${dnsDef.name}):\n`)
  for (const r of records) log.dim(formatDnsRecord(r))
}
