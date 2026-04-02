import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../src/providers.js'
import { getEmailInputDefs } from '../src/core.js'
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
    return `| \`${toFlag(flag)}\` | ${envCell} | ${name} | ${exampleCell} |`
  })
  return [
    '| Flag | Env var | Description | Example |',
    '|------|---------|-------------|---------|',
    ...rows,
  ].join('\n')
}

const lines: string[] = []

lines.push('<!-- generated -->')
lines.push('')

// Summary tables
lines.push('## Supported Email providers')
lines.push('')
lines.push('| Provider | Key |')
lines.push('|----------|-----|')
for (const [key, def] of Object.entries(EMAIL_PROVIDERS)) {
  lines.push(`| [${def.name}](#${toAnchor(def.name)}) | \`${key}\` |`)
}
lines.push('')

lines.push('## Supported DNS providers')
lines.push('')
lines.push('| Provider | Key |')
lines.push('|----------|-----|')
for (const [key, def] of Object.entries(DNS_PROVIDERS)) {
  lines.push(`| [${def.name}](#${toAnchor(def.name)}) | \`${key}\` |`)
}
lines.push('')

// Email providers detail
lines.push('## Email providers')
lines.push('')
for (const [key, def] of Object.entries(EMAIL_PROVIDERS)) {
  lines.push(`### ${def.name}`)
  lines.push('')
  if (def.type === 'hybrid') {
    lines.push(def.autoExplanation)
    lines.push('')
    lines.push('#### Inputs')
    lines.push('')
    lines.push('##### Auto Mode')
    lines.push('')
    lines.push(inputTable(getEmailInputDefs(key, 'auto')))
    lines.push('')
    lines.push('##### Manual Mode (default)')
    lines.push('')
    lines.push(inputTable(getEmailInputDefs(key, 'manual')))
  } else {
    const inputs = getEmailInputDefs(key)
    if (inputs.length > 0) {
      lines.push('#### Inputs')
      lines.push('')
      lines.push(inputTable(inputs))
    }
  }
  lines.push('')
}

// DNS providers detail
lines.push('## DNS providers')
lines.push('')
for (const [key, def] of Object.entries(DNS_PROVIDERS)) {
  lines.push(`### ${def.name}`)
  lines.push('')
  lines.push('#### Inputs')
  lines.push('')
  lines.push(inputTable(def.inputs))
  lines.push('')
}

lines.push('<!-- /generated -->')

const generated = lines.join('\n')

const readme = readFileSync(readmePath, 'utf8')
const startMarker = '<!-- generated -->'
const endMarker = '<!-- /generated -->'
const start = readme.indexOf(startMarker)
const end = readme.indexOf(endMarker) + endMarker.length
const updated = readme.slice(0, start) + generated + '\n'

writeFileSync(readmePath, updated)
console.log('README.md updated.')
