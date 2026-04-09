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

function optionsTable(opts, title) {
  let lines = [];
  lines.push('')
  lines.push(`#### ${title}`)
  lines.push('')
  lines.push('| Flag | Description | Default |')
  lines.push('|------|-------------|---------|')
  for (const o of opts) {
    const flag = o.short ? `<nobr>\`-${o.short}\`, \`${toFlag(o.flag)}\`</nobr>` : `<nobr>\`${toFlag(o.flag)}\`</nobr>`
    lines.push(`| ${flag} | ${o.description} | \`${o.default}\` |`)
  }
  return lines;
}

function commandUsageSection(key: string, extra: string[] = []): string[] {
  const cmd = COMMANDS[key]
  const optsPart = cmd.options.length ? ' [options]' : ''
  const argsPart = cmd.args.map(a => `<${a.name}>`).join(' ')
  const lines: string[] = []
  lines.push(`### ${ucfirst(key)}`)
  lines.push('')
  lines.push(cmd.description)
  lines.push('')
  lines.push('```bash')
  lines.push(`mail2dns ${key}${optsPart} ${argsPart}`)
  lines.push('```')

  const providerLines: string[] = []
  for (const arg of cmd.args) {
    if (arg.name === 'email-provider') {
      providerLines.push('#### [Email Providers](#-supported-email-providers)', '', Object.keys(EMAIL_PROVIDERS).join(', '))
    } else if (arg.name === 'dns-provider') {
      providerLines.push('#### [DNS Providers](#-supported-dns-providers)', '', Object.keys(DNS_PROVIDERS).join(', '))
    }
  }

  const allExtra = [...providerLines, ...extra]
  if (allExtra.length) lines.push('', ...allExtra)
  if (cmd.options.length) lines.push(...optionsTable(cmd.options, 'Options'))
  lines.push('')
  return lines
}

// --- generated-usage ---

const providersExtra = [
  '#### Provider Options',
  '',
  'Provider-specific options are prompted interactively if not provided via flag or environment variable. See the providers reference below.',
]

const usageLines: string[] = []
usageLines.push('<!-- generated-usage -->')
usageLines.push('')
usageLines.push('## ⚙️ Usage')
usageLines.push('')
usageLines.push(...commandUsageSection('setup', providersExtra))
usageLines.push(...commandUsageSection('verify', providersExtra))
usageLines.push(...commandUsageSection('list', providersExtra))

usageLines.push('<!-- /generated-usage -->')

// --- generated-providers-reference ---

const refLines: string[] = []
refLines.push('<!-- generated-providers-reference -->')
refLines.push('')

refLines.push('## ✅ Supported Email providers')
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
