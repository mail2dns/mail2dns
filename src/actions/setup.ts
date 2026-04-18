import { DNS_PROVIDERS, EMAIL_PROVIDERS } from '../providers.js'
import { resolveInputs, assertNoInsecureFlags, setConfirm, setSuppressComplete, confirm, ask, log } from '../utils.js'
import { validateDomain, validateEmailProvider, validateDnsProvider } from '../validate.js'
import { buildRecords, getEmailInputDefs } from '../email.js'
import { zonePrefix, normalizePrefix, buildVerifyRecords, checkDnsRecord, toFullName } from '../core.js'

export async function setup(
  domain: string,
  emailProvider: string,
  dnsProvider: string,
  opts: Record<string, string | undefined>
): Promise<void> {
  validateDomain(domain)
  validateEmailProvider(emailProvider)
  validateDnsProvider(dnsProvider)

  const yes = !!opts.yes
  const dryRun = !!opts.dryRun
  const allowInsecureFlags = !!opts.allowInsecureFlags || process.env.M2D_ALLOW_INSECURE_FLAGS === 'true'
  const emailInputDefs = getEmailInputDefs(emailProvider)
  const dnsDef = DNS_PROVIDERS[dnsProvider]

  if (!allowInsecureFlags) {
    assertNoInsecureFlags(
        [...emailInputDefs, ...dnsDef.inputs],
        opts,
        `${process.env.M2D_BASE_URL ?? 'https://mail2dns.com'}/setup/${emailProvider}/${dnsProvider}#protecting-secrets`
    )
  }

  const dnsInputs = await resolveInputs(dnsDef.inputs, opts, yes)
  const zone = opts.zone ?? (dnsDef.resolveZone ? await dnsDef.resolveZone(domain, dnsInputs) : domain)
  const prefix = zonePrefix(domain, zone)

  if (yes) setConfirm(async () => true)

  const emailDef = EMAIL_PROVIDERS[emailProvider]
  const hasVerifyStage = emailDef.type === 'template' && emailDef.template.records.some(r => r.verifyOnly)

  let verifyInputs: Record<string, string> = {}

  if (hasVerifyStage && emailDef.type === 'template') {
    const verifyOnlyInputDefs = emailInputDefs.filter(i => i.verifyOnly)
    verifyInputs = await resolveInputs(verifyOnlyInputDefs, opts, yes)
    verifyInputs.dmarcPolicy = opts.dmarcPolicy as string

    const verifyRecords = buildVerifyRecords(
      { ...emailDef.template, records: emailDef.template.records.filter(r => r.verifyOnly) },
      domain,
      verifyInputs
    )
    const allPresent = (await Promise.all(
      verifyRecords.map(vr => checkDnsRecord(vr, toFullName(vr.name, domain)))
    )).every(Boolean)

    if (!allPresent) {
      let proceeded = yes
      if (!yes) setConfirm(async (q) => { proceeded = await confirm(q); return proceeded })
      const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs: verifyInputs, noMx: !opts.mx, verifyOnly: true })
      const adjusted = prefix ? records.map(r => ({ ...r, name: normalizePrefix(r.name, prefix) })) : records
      setSuppressComplete(true)
      await dnsDef.setupRecords({ domain: zone, records: adjusted, verificationPrefix, dryRun }, dnsInputs)
      setSuppressComplete(false)
      if (yes) setConfirm(async () => true); else setConfirm(confirm)
      if (!proceeded && !dryRun) { log.info('Aborted.'); return }
      if (!yes) await ask(`\nBefore proceeding, ensure your domain is verified in the ${emailDef.name} dashboard, then press Enter to continue...`)
    }
  }

  const remainingInputDefs = hasVerifyStage ? emailInputDefs.filter(i => !i.verifyOnly) : emailInputDefs
  const emailInputs = { ...verifyInputs, ...(await resolveInputs(remainingInputDefs, opts, yes)) }
  emailInputs.dmarcPolicy = opts.dmarcPolicy as string

  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, noMx: !opts.mx, excludeVerifyOnly: hasVerifyStage })
  const adjustedRecords = prefix ? records.map(r => ({ ...r, name: normalizePrefix(r.name, prefix) })) : records
  await dnsDef.setupRecords({ domain: zone, records: adjustedRecords, verificationPrefix, dryRun }, dnsInputs)
}
