import { DNS_PROVIDERS } from '../providers.js'
import { resolveInputs, log, formatDnsRecord } from '../utils.js'
import { validateDomain, validateDnsProvider } from '../validate.js'

export async function list(
  domain: string,
  dnsProvider: string,
  opts: Record<string, string | undefined>
): Promise<void> {
  validateDomain(domain)
  validateDnsProvider(dnsProvider)
  const dnsDef = DNS_PROVIDERS[dnsProvider]
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts, false)
  const records = await dnsDef.listRecords(domain, dnsInputs)
  if (records.length === 0) {
    log.warn('No DNS records found.')
    return
  }
  log.info(`\nDNS records for ${domain} (${dnsDef.name}):\n`)
  for (const r of records) log.dim(formatDnsRecord(r))
}
