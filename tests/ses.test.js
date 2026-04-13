import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecordsFromExec } from '../src/email-modules/ses.js'
import { makeFake } from './fakes/ses.js'
const fake = makeFake()
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'

describe('buildRecordsFromExec', () => {
  it('returns 7 DNS records', async () => {
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    assert.equal(records.length, 7)
  })

  it('TXT _amazonses contains the verification token', async () => {
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    const txt = records.find(r => r.type === 'TXT' && r.name === '_amazonses')
    assert.ok(txt, 'TXT _amazonses record not found')
    assert.equal(txt.content, fake.state.verificationToken)
  })

  it('MX record uses the region returned by the CLI', async () => {
    fake.setRegion('eu-west-1')
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    const mx = records.find(r => r.type === 'MX')
    assert.ok(mx, 'MX record not found')
    assert.ok(mx.content.includes('eu-west-1'), `expected region in MX content, got: ${mx.content}`)
  })

  it('includes SPF TXT record at @', async () => {
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    const spf = records.find(r => r.type === 'TXT' && r.name === '@')
    assert.ok(spf, 'SPF TXT record not found')
    assert.ok(spf.content.includes('v=spf1'), `expected SPF content, got: ${spf.content}`)
    assert.ok(spf.content.includes('amazonses.com'), `expected amazonses.com in SPF, got: ${spf.content}`)
  })

  it('includes DMARC TXT record at _dmarc', async () => {
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    const dmarc = records.find(r => r.type === 'TXT' && r.name === '_dmarc')
    assert.ok(dmarc, 'DMARC record not found')
    assert.ok(dmarc.content.includes('v=DMARC1'), `expected DMARC content, got: ${dmarc.content}`)
  })

  it('produces 3 DKIM CNAME records pointing at dkim.amazonses.com', async () => {
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    const cnames = records.filter(r => r.type === 'CNAME' && r.name.includes('_domainkey'))
    assert.equal(cnames.length, 3)
    for (const c of cnames) {
      assert.ok(c.content.endsWith('.dkim.amazonses.com'), `unexpected CNAME content: ${c.content}`)
    }
  })

  it('DKIM CNAME names are derived from the returned tokens', async () => {
    const records = await buildRecordsFromExec(DOMAIN, [], fake.exec)
    const cnames = records.filter(r => r.type === 'CNAME')
    for (const token of fake.state.dkimTokens) {
      assert.ok(cnames.some(c => c.name === `${token}._domainkey`), `no CNAME for token: ${token}`)
    }
  })

  it('prepends profile args to all CLI calls', async () => {
    await buildRecordsFromExec(DOMAIN, ['--profile', 'my-profile'], fake.exec)
    for (const call of fake.state.calls) {
      assert.ok(call.includes('--profile'), `call missing --profile: ${call.join(' ')}`)
      assert.ok(call.includes('my-profile'), `call missing profile value: ${call.join(' ')}`)
    }
  })

  it('throws if VerificationToken is absent', async () => {
    fake.setVerificationToken('')
    await assert.rejects(
      () => buildRecordsFromExec(DOMAIN, [], fake.exec),
      /verification token/i
    )
  })

  it('throws if fewer than 3 DKIM tokens are returned', async () => {
    fake.setDkimTokens(['only-one', 'only-two'])
    await assert.rejects(
      () => buildRecordsFromExec(DOMAIN, [], fake.exec),
      /3 DKIM tokens/i
    )
  })

  it('throws a helpful error when the AWS CLI is unavailable', async () => {
    fake.setError(Object.assign(new Error('spawn aws ENOENT'), { stderr: '' }))
    await assert.rejects(
      () => buildRecordsFromExec(DOMAIN, [], fake.exec),
      /AWS CLI error/i
    )
  })
})
