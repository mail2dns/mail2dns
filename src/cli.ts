import { Command, Option } from 'commander'
import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'
import { camelToKebab, log } from './utils.js'
import { COMMANDS } from './commands.js'
import buildInfo from './buildInfo.js'
import type { InputDef } from './types.js'
import { setup } from './actions/setup.js'
import { list } from './actions/list.js'
import { verify } from './actions/verify.js'

const program = new Command()

program
  .name('mail2dns')
  .description('Configure DNS records for email providers')
  .version(buildInfo.version, '-v, --version', 'output the version number')

/** Register all provider input flags as hidden options so Commander parses them */
function registerProviderOptions(cmd: Command): void {
  const seen = new Set<string>()
  const allInputs: InputDef[] = [
    ...Object.values(EMAIL_PROVIDERS).flatMap(p =>
      p.type === 'template' ? (p.template.inputs ?? []) : p.inputs
    ),
    ...Object.values(DNS_PROVIDERS).flatMap(p => p.inputs)
  ]
  for (const input of allInputs) {
    if (seen.has(input.flag)) continue
    seen.add(input.flag)
    cmd.addOption(new Option(`--${camelToKebab(input.flag)} <value>`, input.name).hideHelp())
  }
}

function formatInputLine(input: InputDef): string {
  const flag = `--${camelToKebab(input.flag)} <value>`
  const env = input.env ? `  [env: ${input.env}]` : ''
  const optional = input.optional ? ' (optional)' : ''
  return `    ${flag.padEnd(38)} ${input.name}${optional}${env}`
}

function buildEmailHelpText(): string {
  // Group providers that share the same template/inputs object identity
  const identityToNames = new Map<object, string[]>()
  const identityToInputs = new Map<object, InputDef[]>()

  for (const [key, def] of Object.entries(EMAIL_PROVIDERS)) {
    const identity: object = def.type === 'template' ? def.template : def.inputs
    const inputs: InputDef[] = def.type === 'template' ? (def.template.inputs ?? []) : def.inputs
    if (!identityToNames.has(identity)) {
      identityToNames.set(identity, [])
      identityToInputs.set(identity, inputs)
    }
    identityToNames.get(identity)!.push(key)
  }

  const lines: string[] = ['\nEmail provider options:']
  for (const [identity, names] of identityToNames) {
    const inputs = identityToInputs.get(identity)!
    if (inputs.length === 0) continue
    lines.push(`\n  ${names.join(', ')}:`)
    for (const input of inputs) lines.push(formatInputLine(input))
  }
  return lines.join('\n')
}

function buildDnsHelpText(): string {
  const lines: string[] = ['\nDNS provider options:']
  for (const [key, def] of Object.entries(DNS_PROVIDERS)) {
    if (def.inputs.length === 0) continue
    lines.push(`\n  ${key}:`)
    for (const input of def.inputs) lines.push(formatInputLine(input))
  }
  return lines.join('\n')
}


const setupCmd = program
  .command('setup')
  .description(COMMANDS.setup.description)
  .argument('<domain>')
  .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)
  .argument('<dns-provider>',   `(${Object.keys(DNS_PROVIDERS).join(', ')})`)

registerProviderOptions(setupCmd)
for (const o of COMMANDS.setup.options) {
  const kebab = camelToKebab(o.flag)
  const flags = o.short ? `-${o.short}, --${kebab}` : `--${kebab}`
  setupCmd.option(flags, o.description)
}
setupCmd
  .addHelpText('after', buildEmailHelpText() + '\n' + buildDnsHelpText())
  .action((domain: string, emailProvider: string, dnsProvider: string, opts: Record<string, string | undefined>) =>
    setup(domain, emailProvider, dnsProvider, opts)
  )

const listCmd = program
  .command('list')
  .description(COMMANDS.list.description)
  .argument('<domain>')
  .argument('<dns-provider>', `(${Object.keys(DNS_PROVIDERS).join(', ')})`)

registerProviderOptions(listCmd)
listCmd
  .addHelpText('after', buildDnsHelpText())
  .action((domain: string, dnsProvider: string, opts: Record<string, string | undefined>) =>
    list(domain, dnsProvider, opts)
  )

const verifyCmd = program
  .command('verify')
  .description(COMMANDS.verify.description)
  .argument('<domain>')
  .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)

registerProviderOptions(verifyCmd)
for (const o of COMMANDS.verify.options) {
  const kebab = camelToKebab(o.flag)
  const flags = o.short ? `-${o.short}, --${kebab}` : `--${kebab}`
  verifyCmd.option(flags, o.description)
}
verifyCmd
  .addHelpText('after', buildEmailHelpText())
  .action((domain: string, emailProvider: string, opts: Record<string, string | undefined>) =>
    verify(domain, emailProvider, opts)
  )

try {
  await program.parseAsync()
} catch (err: any) {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
