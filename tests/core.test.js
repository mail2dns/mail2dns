import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecords } from '../src/email.js'

const DOMAIN = 'example.com'

describe('buildRecords', () => {
  it('returns records for a template provider', async () => {
    const { records } = await buildRecords({
      domain: DOMAIN,
      emailProvider: 'migadu',
      emailInputs: { verifyTxt: 'hosted-email-verify=abc123' }
    })
    assert.ok(records.length > 0)
    assert.ok(records.some(r => r.type === 'MX'))
    assert.ok(records.some(r => r.type === 'TXT'))
    assert.ok(records.some(r => r.type === 'CNAME'))
  })

  it('substitutes {DOMAIN} placeholder in record values', async () => {
    const { records } = await buildRecords({
      domain: DOMAIN,
      emailProvider: 'migadu',
      emailInputs: { verifyTxt: 'hosted-email-verify=abc123' }
    })
    const cname = records.find(r => r.type === 'CNAME')
    assert.ok(cname, 'expected a CNAME record')
    assert.ok(cname.content.includes(DOMAIN), `expected {DOMAIN} replaced in content, got: ${cname.content}`)
  })

  it('substitutes input placeholders in record values', async () => {
    const { records } = await buildRecords({
      domain: DOMAIN,
      emailProvider: 'migadu',
      emailInputs: { verifyTxt: 'hosted-email-verify=abc123' }
    })
    const txt = records.find(r => r.type === 'TXT' && r.content.includes('hosted-email-verify'))
    assert.ok(txt, 'expected verification TXT record with substituted value')
  })

  it('preserves MX records by default', async () => {
    const { records } = await buildRecords({
      domain: DOMAIN,
      emailProvider: 'migadu',
      emailInputs: { verifyTxt: 'hosted-email-verify=abc123' }
    })
    assert.ok(records.some(r => r.type === 'MX'))
  })

  it('strips MX records when noMx is true', async () => {
    const { records } = await buildRecords({
      domain: DOMAIN,
      emailProvider: 'migadu',
      emailInputs: { verifyTxt: 'hosted-email-verify=abc123' },
      noMx: true
    })
    assert.equal(records.filter(r => r.type === 'MX').length, 0)
    assert.ok(records.some(r => r.type === 'TXT'), 'non-MX records should still be present')
    assert.ok(records.some(r => r.type === 'CNAME'), 'non-MX records should still be present')
  })

  it('strips MX records for resend when noMx is true', async () => {
    const inputs = { dkimKey: 'p=abc123', resendRegion: 'us-east-1' }
    const { records: withMx }    = await buildRecords({ domain: DOMAIN, emailProvider: 'resend', emailInputs: inputs })
    const { records: withoutMx } = await buildRecords({ domain: DOMAIN, emailProvider: 'resend', emailInputs: inputs, noMx: true })
    assert.ok(withMx.some(r => r.type === 'MX'))
    assert.equal(withoutMx.filter(r => r.type === 'MX').length, 0)
    assert.ok(withoutMx.some(r => r.type === 'TXT'), 'non-MX records should still be present')
  })
})
