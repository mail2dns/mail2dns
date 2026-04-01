import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../src/providers.js'
import { getEmailInputDefs } from '../src/core.js'

const output = {
  dnsProviders: Object.fromEntries(
    Object.entries(DNS_PROVIDERS).map(([key, def]) => [key, { inputs: def.inputs }])
  ),
  emailProviders: Object.fromEntries(
    Object.entries(EMAIL_PROVIDERS).map(([key, def]) => {
      if (def.type === 'hybrid') {
        return [key, {
          inputs:     getEmailInputDefs(key, 'manual'),
          autoInputs: getEmailInputDefs(key, 'auto')
        }]
      }
      return [key, { inputs: getEmailInputDefs(key) }]
    })
  )
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
