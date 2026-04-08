import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'

export function validateDomain(domain: string): void {
  if (domain.length > 253)
    throw new Error(`Invalid domain: ${domain}`)
  const labels = domain.split('.')
  if (labels.length < 2)
    throw new Error(`Invalid domain: ${domain}`)
  for (const label of labels) {
    if (label.length === 0 || label.length > 63 || !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))
      throw new Error(`Invalid domain: ${domain}`)
  }
  if (/^\d+$/.test(labels[labels.length - 1]))
    throw new Error(`Invalid domain: ${domain}`)
}

export function validateEmailProvider(emailProvider: string): void {
  if (!EMAIL_PROVIDERS[emailProvider])
    throw new Error(`Unknown email provider: ${emailProvider}\nSupported: ${Object.keys(EMAIL_PROVIDERS).join(', ')}`)
}

export function validateDnsProvider(dnsProvider: string): void {
  if (!DNS_PROVIDERS[dnsProvider])
    throw new Error(`Unknown DNS provider: ${dnsProvider}\nSupported: ${Object.keys(DNS_PROVIDERS).join(', ')}`)
}
