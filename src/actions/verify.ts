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
    verifyRecords = buildVerifyRecords(emailDef.template, domain, { dmarcPolicy: opts.dmarcPolicy as string })
    if (!opts.mx) verifyRecords = verifyRecords.filter(r => r.type !== 'MX')
  } else {
    const emailInputs = await resolveInputs(emailDef.inputs, opts, false)
    const records = await emailDef.getRecords({ domain, ...emailInputs })
    verifyRecords = records
      .filter(r => opts.mx || r.type !== 'MX')
      .map(r => ({ ...r, match: 'exact' as const }))
  }

  log.info(`\nVerifying DNS records for ${domain}:\n`)

  const rows = await Promise.all(verifyRecords.map(async vr => {
    const found = await checkDnsRecord(vr, toFullName(vr.name, domain))
    const col1 = `[${vr.type.padEnd(5)}] ${vr.name}`
    const col2 = vr.match === 'pattern' ? `/${vr.pattern.source}/` : vr.content
    const col3 = found ?? '(not found)'
    return { found, col1, col2, col3 }
  }))

  let missing = 0
  for (const { found, col1, col2, col3 } of rows) {
    log.dim(`  Expected: ${col1} → ${col2}`)
    if (found) {
      log.success(`  Actual:   ${col1} → ${col3}`)
    } else {
      log.error(`  Actual:   ${col1} → ${col3}`)
      missing++
    }
    log.info('')
  }

  log.info('')
  if (missing === 0) {
    log.success(`All ${verifyRecords.length} records present.`)
  } else {
    log.warn(`${verifyRecords.length - missing} of ${verifyRecords.length} records present. ${missing} missing.`)
    process.exit(1)
  }
}
