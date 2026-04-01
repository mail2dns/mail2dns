import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../src/providers.js'
import { getEmailInputDefs } from '../src/core.js'

const output = {
  dnsProviders: Object.fromEntries(
    Object.entries(DNS_PROVIDERS).map(([key, def]) => [key, { inputs: def.inputs }])
  ),
  emailProviders: Object.fromEntries(
    Object.keys(EMAIL_PROVIDERS).map(key => [key, { inputs: getEmailInputDefs(key) }])
  )
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
