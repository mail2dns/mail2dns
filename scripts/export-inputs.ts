import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../src/providers.js'
import { getEmailInputDefs } from '../src/core.js'
import migaduTemplate from '../src/email-templates/migadu.json' assert { type: 'json' }
import googleworkspaceTemplate from '../src/email-templates/googleworkspace.json' assert { type: 'json' }
import sesTemplate from '../src/email-templates/ses.json' assert { type: 'json' }

const EMAIL_TEMPLATES: Record<string, typeof migaduTemplate> = {
  migadu: migaduTemplate,
  googleworkspace: googleworkspaceTemplate,
  ses: sesTemplate,
}

const output = {
  dnsProviders: Object.fromEntries(
    Object.entries(DNS_PROVIDERS).map(([key, def]) => {
      return [key, { name: def.name, inputs: def.inputs }]
    })
  ),
  emailProviders: Object.fromEntries(
    Object.entries(EMAIL_PROVIDERS).map(([key, def]) => {
      const template = EMAIL_TEMPLATES[key]
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
