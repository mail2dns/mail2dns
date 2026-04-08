import { Command, Option } from 'commander'
import { EMAIL_PROVIDERS, DNS_PROVIDERS } from './providers.js'
import { resolveInputs, camelToKebab, log, formatDnsRecord } from './utils.js'
import { COMMANDS } from './commands.js'
import { validateDomain, validateEmailProvider, validateDnsProvider } from './validate.js'
import { buildRecords, getEmailInputDefs, buildVerifyRecords, toFullName, checkDnsRecord } from './core.js'
import type { VerifyRecord } from './types.js'
import buildInfo from './buildInfo.js'
import type { InputDef } from './types.js'

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
  .action(async (domain: string, emailProvider: string, dnsProvider: string, opts: Record<string, string | undefined>) => {
    validateDomain(domain)
    validateEmailProvider(emailProvider)
    validateDnsProvider(dnsProvider)

    const yes = !!opts.yes
    const dryRun = !!opts.dryRun
    const emailInputDefs = getEmailInputDefs(emailProvider)
    const emailInputs = await resolveInputs(emailInputDefs, opts, yes)
    const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, noMx: !!opts.noMx })

    const dnsDef = DNS_PROVIDERS[dnsProvider]
    const dnsInputs = await resolveInputs(dnsDef.inputs, opts, yes)

    const confirm = yes ? async () => true : undefined
    await dnsDef.setupRecords({ domain, records, verificationPrefix, confirm, dryRun }, dnsInputs)
  })

const listCmd = program
  .command('list')
  .description(COMMANDS.list.description)
  .argument('<domain>')
  .argument('<dns-provider>', `(${Object.keys(DNS_PROVIDERS).join(', ')})`)

registerProviderOptions(listCmd)
listCmd
  .addHelpText('after', buildDnsHelpText())
  .action(async (domain: string, dnsProvider: string, opts: Record<string, string | undefined>) => {
    validateDomain(domain)
    validateDnsProvider(dnsProvider)
    const dnsDef = DNS_PROVIDERS[dnsProvider]
    const dnsInputs = await resolveInputs(dnsDef.inputs, opts, false)
    const records = await dnsDef.listRecords(domain, dnsInputs)
    if (records.length === 0) {
      log.warn('No DNS records found.')
      return
    }
    log.info(`\nDNS records for ${domain} (${dnsDef.name}):\n`)
    for (const r of records) log.dim(formatDnsRecord(r))
  })

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
  .action(async (domain: string, emailProvider: string, opts: Record<string, string | undefined>) => {
    validateDomain(domain)
    validateEmailProvider(emailProvider)

    const emailDef = EMAIL_PROVIDERS[emailProvider]
    let verifyRecords: VerifyRecord[]

    if (emailDef.type === 'template') {
      verifyRecords = buildVerifyRecords(emailDef.template, domain)
      if (opts.noMx) verifyRecords = verifyRecords.filter(r => r.type !== 'MX')
    } else {
      const emailInputs = await resolveInputs(emailDef.inputs, opts, false)
      const records = await emailDef.getRecords({ domain, ...emailInputs })
      verifyRecords = records
        .filter(r => !opts.noMx || r.type !== 'MX')
        .map(r => ({ ...r, match: 'exact' as const }))
    }

    log.info(`\nVerifying DNS records for ${domain}:\n`)

    let missing = 0
    for (const vr of verifyRecords) {
      const fullName = toFullName(vr.name, domain)
      const found = await checkDnsRecord(vr, fullName)
      const label = vr.match === 'exact' ? vr.content : vr.display
      const line = `  [${vr.type.padEnd(5)}] ${vr.name} → ${label}`
      if (found) {
        log.success(`  ✓${line}`)
      } else {
        log.error(`  ✗${line}`)
        missing++
      }
    }

    log.info('')
    if (missing === 0) {
      log.success(`All ${verifyRecords.length} records present.`)
    } else {
      log.warn(`${verifyRecords.length - missing} of ${verifyRecords.length} records present. ${missing} missing.`)
      process.exit(1)
    }
  })

try {
  await program.parseAsync()
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
