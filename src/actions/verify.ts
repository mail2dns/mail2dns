import { EMAIL_PROVIDERS } from '../providers.js'
import { resolveInputs, log } from '../utils.js'
import { validateDomain, validateEmailProvider } from '../validate.js'
import { buildVerifyRecords, toFullName, checkDnsRecord } from '../core.js'
import type { VerifyRecord } from '../types.js'

export async function verify(
  domain: string,
  emailProvider: string,
  opts: Record<string, string | undefined>
): Promise<void> {
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
}
