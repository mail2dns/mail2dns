import { Command, Option } from 'commander'
import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'
import { resolveInputs, camelToKebab, validateProviders, COMMANDS, log } from './utils.js'
import { buildRecords, getEmailInputDefs } from './core.js'
import type { InputDef } from './types.js'

const program = new Command()

program
  .name('mail2dns')
  .description('Configure DNS records for email providers')

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
  .action(async (domain: string, emailProvider: string, dnsProvider: string, opts: Record<string, string | undefined>) => {
    validateProviders(emailProvider, dnsProvider)

    const yes = !!opts.yes
    const emailInputDefs = getEmailInputDefs(emailProvider)
    const emailInputs = await resolveInputs(emailInputDefs, opts, yes)
    const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, noMx: !!opts.noMx })

    const dnsDef = DNS_PROVIDERS[dnsProvider]
    const dnsInputs = await resolveInputs(dnsDef.inputs, opts, yes)

    const confirm = yes ? async () => true : undefined
    await dnsDef.setupRecords({ domain, records, verificationPrefix, confirm }, dnsInputs)
  })

program
  .command('preview')
  .description(COMMANDS.preview.description)
  .argument('<domain>')
  .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)
  .action(async (_domain: string, _emailProvider: string) => {
    log.warn('preview not yet implemented')
  })

program
  .command('list')
  .description(COMMANDS.list.description)
  .argument('<domain>')
  .argument('<dns-provider>', `(${Object.keys(DNS_PROVIDERS).join(', ')})`)
  .action(async (_domain: string, _dnsProvider: string) => {
    log.warn('list not yet implemented')
  })

program
  .command('verify')
  .description(COMMANDS.verify.description)
  .argument('<domain>')
  .argument('<email-provider>', `(${Object.keys(EMAIL_PROVIDERS).join(', ')})`)
  .argument('<dns-provider>',   `(${Object.keys(DNS_PROVIDERS).join(', ')})`)
  .action(async (_domain: string, _emailProvider: string, _dnsProvider: string) => {
    log.warn('verify not yet implemented')
  })

try {
  await program.parseAsync()
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
