import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../src/providers.js'
import { getEmailInputDefs } from '../src/core.js'
import { ucfirst } from '../src/utils.js'
import { COMMANDS } from '../src/commands.js'
import type { InputDef } from '../src/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const readmePath = join(__dirname, '..', 'README.md')

function toFlag(camelCase: string): string {
  return '--' + camelCase.replace(/([A-Z])/g, c => '-' + c.toLowerCase())
}

function toAnchor(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

function inputTable(inputs: InputDef[]): string {
  const rows = inputs.map(({ flag, env, name, example }) => {
    const envCell = env ? `\`${env}\`` : ''
    const exampleCell = example ? `\`${example}\`` : ''
    return `| <nobr>\`${toFlag(flag)}\`</nobr> | ${envCell} | ${name} | ${exampleCell} |`
  })
  return [
    '| Flag | Env var | Description | Example |',
    '|------|---------|-------------|---------|',
    ...rows,
  ].join('\n')
}

function replaceBlock(content: string, marker: string, generated: string): string {
  const open = `<!-- ${marker} -->`
  const close = `<!-- /${marker} -->`
  const start = content.indexOf(open)
  const end = content.indexOf(close) + close.length
  return content.slice(0, start) + generated + content.slice(end)
}

// --- generated-usage ---

const emailProviderKeys = Object.keys(EMAIL_PROVIDERS).join(', ')
const dnsProviderKeys = Object.keys(DNS_PROVIDERS).join(', ')

const usageLines: string[] = []
usageLines.push('<!-- generated-usage -->')
usageLines.push('')
usageLines.push('## ⚙️ Usage')
usageLines.push('')

// Setup
usageLines.push(`### ${ucfirst('setup')}`)
usageLines.push('')
usageLines.push(COMMANDS.setup.description)
usageLines.push('')
const setupOpts = COMMANDS.setup.options
const setupOptsPart = setupOpts.length ? ' [options]' : ''
usageLines.push('```bash')
usageLines.push(`mail2dns setup${setupOptsPart} <domain> <email-provider> <dns-provider>`)
usageLines.push('```')
usageLines.push('')
usageLines.push('#### [Email Providers](#supported-email-providers)')
usageLines.push('')
usageLines.push(emailProviderKeys)
usageLines.push('')
usageLines.push('#### [DNS Providers](#supported-dns-providers)')
usageLines.push('')
usageLines.push(dnsProviderKeys)
usageLines.push('')
usageLines.push('#### Provider Options')
usageLines.push('')
usageLines.push('Provider-specific options are prompted interactively if not provided via flag or environment variable. See the providers reference below.')
if (setupOpts.length) {
  usageLines.push('')
  usageLines.push('#### General Options')
  usageLines.push('')
  usageLines.push('| Flag | Description | Default |')
  usageLines.push('|------|-------------|---------|')
  for (const o of setupOpts) {
    const flag = o.short ? `<nobr>\`-${o.short}\`, \`${toFlag(o.flag)}\`</nobr>` : `<nobr>\`${toFlag(o.flag)}\`</nobr>`
    usageLines.push(`| ${flag} | ${o.description} | \`${o.default}\` |`)
  }
}
usageLines.push('')

// Verify
usageLines.push(`### ${ucfirst('verify')}`)
usageLines.push('')
usageLines.push(COMMANDS.verify.description)
usageLines.push('')
const verifyOptsPart = COMMANDS.verify.options.length ? ' [options]' : ''
usageLines.push('```bash')
usageLines.push(`mail2dns verify${verifyOptsPart} <domain> <email-provider> <dns-provider>`)
usageLines.push('```')
usageLines.push('')

// List
usageLines.push(`### ${ucfirst('list')}`)
usageLines.push('')
usageLines.push(COMMANDS.list.description)
usageLines.push('')
const listOptsPart = COMMANDS.list.options.length ? ' [options]' : ''
usageLines.push('```bash')
usageLines.push(`mail2dns list${listOptsPart} <domain> <dns-provider>`)
usageLines.push('```')
usageLines.push('')

usageLines.push('<!-- /generated-usage -->')

// --- generated-providers-reference ---

const refLines: string[] = []
refLines.push('<!-- generated-providers-reference -->')
refLines.push('')

refLines.push('## ✅  Supported Email providers')
refLines.push('')
refLines.push('| Provider | Key |')
refLines.push('|----------|-----|')
for (const [key, def] of Object.entries(EMAIL_PROVIDERS)) {
  refLines.push(`| [${def.name}](#${toAnchor(def.name)}) | \`${key}\` |`)
}
refLines.push('')

refLines.push('## ✅ Supported DNS providers')
refLines.push('')
refLines.push('| Provider | Key |')
refLines.push('|----------|-----|')
for (const [key, def] of Object.entries(DNS_PROVIDERS)) {
  refLines.push(`| [${def.name}](#${toAnchor(def.name)}) | \`${key}\` |`)
}
refLines.push('')

refLines.push('## 📧 Email providers')
refLines.push('')
for (const [key, def] of Object.entries(EMAIL_PROVIDERS)) {
  refLines.push(`### ${def.name}`)
  refLines.push('')

  const inputs = getEmailInputDefs(key)

  if (inputs.length > 0) {
    refLines.push('#### Inputs')
    refLines.push('')
    refLines.push(inputTable(inputs))
  }
  refLines.push('')
}

refLines.push('## ⬛ DNS providers')
refLines.push('')
for (const [key, def] of Object.entries(DNS_PROVIDERS)) {
  refLines.push(`### ${def.name}`)
  refLines.push('')
  refLines.push('#### Inputs')
  refLines.push('')
  refLines.push(inputTable(def.inputs))
  refLines.push('')
}

refLines.push('<!-- /generated-providers-reference -->')

// Write both blocks
let readme = readFileSync(readmePath, 'utf8')
readme = replaceBlock(readme, 'generated-usage', usageLines.join('\n'))
readme = replaceBlock(readme, 'generated-providers-reference', refLines.join('\n'))
writeFileSync(readmePath, readme)
console.log('README.md updated.')
