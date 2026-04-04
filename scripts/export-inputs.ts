import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../src/providers.js'
import { getEmailInputDefs } from '../src/core.js'

const output = {
  dnsProviders: Object.fromEntries(
    Object.entries(DNS_PROVIDERS).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([key, def]) => {
      return [key, { name: def.name, inputs: def.inputs }]
    })
  ),
  emailProviders: Object.fromEntries(
    Object.entries(EMAIL_PROVIDERS).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([key, def]) => {
      const template = def.type === 'template' ? def.template : undefined
      const records = template?.records
      const verificationPrefix = template?.verificationPrefix
      if (def.type === 'template' && def.auto) {
        return [key, {
          name: def.name,
          inputs: getEmailInputDefs(key, 'manual'),
          autoInputs: getEmailInputDefs(key, 'auto'),
          autoExplanation: def.auto.explanation,
          records,
          verificationPrefix,
        }]
      }
      return [key, { name: def.name, inputs: getEmailInputDefs(key), records, verificationPrefix }]
    })
  )
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
