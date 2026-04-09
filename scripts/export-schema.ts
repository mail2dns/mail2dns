import {DNS_PROVIDERS, EMAIL_PROVIDERS} from '../src/providers.js'
import {getEmailInputDefs} from '../src/core.js'
import {COMMANDS} from '../src/commands.js'
import { version } from '../package.json'

const output = {
    version,
    setup: {
        options: COMMANDS.setup.options,
        dnsProviders: Object.fromEntries(
            Object.entries(DNS_PROVIDERS).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([key, def]) => {
                return [key, {name: def.name, inputs: def.inputs}]
            })
        ),
        emailProviders: Object.fromEntries(
            Object.entries(EMAIL_PROVIDERS).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([key, def]) => {
                const records = def.type === 'template' ? def.template.records : def.records
                const verificationPrefix = def.type === 'template' ? def.template.verificationPrefix : undefined
                return [
                    key,
                    {
                        name: def.name,
                        inputs: getEmailInputDefs(key),
                        records,
                        hasMx: records?.some(r => r.type === 'MX') || false,
                        verificationPrefix
                    }
                ]
            })
        )
    }
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
