import { Command, Option } from 'commander'
import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'
import { COMMANDS } from './commands.js'
import { log } from './utils.js'
import { version } from '../package.json'
import type { InputDef } from './types.js'
import { setup } from './actions/setup.js'
import { list } from './actions/list.js'
import { verify } from './actions/verify.js'

const program = new Command()

program
  .name('mail2dns')
  .description('Configure DNS records for email providers')
  .version(version, '-v, --version', 'Output the version number')
  .helpOption('-h, --help', 'Display help for command')
  .helpCommand('help [command]', 'Display help for command')

function registerArguments(cmd: Command, args: { name: string; description?: string }[]): void {
  for (const arg of args) {
    const desc = arg.name === 'email-provider' ? `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`
               : arg.name === 'dns-provider'   ? `(${Object.keys(DNS_PROVIDERS).join(', ')})`
               : arg.description
    cmd.argument(`<${arg.name}>`, desc)
  }
}

/** Register all provider input flags as hidden options so Commander parses them */
function registerProviderOptions(cmd: Command): void {
  const seen = new Set<string>()
  const allInputs: InputDef[] = [
    ...Object.values(EMAIL_PROVIDERS).flatMap(p => p.inputs),
    ...Object.values(DNS_PROVIDERS).flatMap(p => p.inputs)
  ]
  for (const input of allInputs) {
    if (seen.has(input.flag)) continue
    seen.add(input.flag)
    cmd.addOption(new Option(`${input.cliFlag} <value>`, input.name).hideHelp())
  }
}

function formatInputLine(input: InputDef): string {
  const flag = `${input.cliFlag} <${input.value || 'value'}>`
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
    const inputs: InputDef[] = def.inputs
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
registerArguments(setupCmd, COMMANDS.setup.args)

registerProviderOptions(setupCmd)
for (const o of COMMANDS.setup.options) {
  const flagStr = o.value ? `${o.cliFlag} <${o.value}>` : o.cliFlag
  const flags = o.short ? `-${o.short}, ${flagStr}` : flagStr
  setupCmd.option(flags, o.description, o.default || undefined)
}
setupCmd
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText('after', buildEmailHelpText() + '\n' + buildDnsHelpText())
  .action((domain: string, emailProvider: string, dnsProvider: string, opts: Record<string, string | undefined>) =>
    setup(domain, emailProvider, dnsProvider, opts)
  )

const listCmd = program
  .command('list')
  .description(COMMANDS.list.description)
registerArguments(listCmd, COMMANDS.list.args)

registerProviderOptions(listCmd)
for (const o of COMMANDS.list.options) {
  const flagStr = o.value ? `${o.cliFlag} <${o.value}>` : o.cliFlag
  const flags = o.short ? `-${o.short}, ${flagStr}` : flagStr
  listCmd.option(flags, o.description, o.default || undefined)
}
listCmd
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText('after', buildDnsHelpText())
  .action((domain: string, dnsProvider: string, opts: Record<string, string | undefined>) =>
    list(domain, dnsProvider, opts)
  )

const verifyCmd = program
  .command('verify')
  .description(COMMANDS.verify.description)
registerArguments(verifyCmd, COMMANDS.verify.args)

registerProviderOptions(verifyCmd)
for (const o of COMMANDS.verify.options) {
  const flagStr = o.value ? `${o.cliFlag} <${o.value}>` : o.cliFlag
  const flags = o.short ? `-${o.short}, ${flagStr}` : flagStr
  verifyCmd.option(flags, o.description, o.default || undefined)
}
verifyCmd
  .helpOption('-h, --help', 'Display help for command')
  .addHelpText('after', buildEmailHelpText())
  .action((domain: string, emailProvider: string, opts: Record<string, string | undefined>) =>
    verify(domain, emailProvider, opts)
  )

process.on('unhandledRejection', (reason) => {
  log.error(reason instanceof Error ? reason.message : String(reason))
  process.exit(1)
})

try {
  await program.parseAsync()
  process.exit(0)
} catch (err: any) {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
