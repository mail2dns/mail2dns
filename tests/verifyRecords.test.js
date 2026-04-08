import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildVerifyRecords, toFullName, checkDnsRecord } from '../src/core.js'

const DOMAIN = 'example.com'

// ---------------------------------------------------------------------------
// buildVerifyRecords
// ---------------------------------------------------------------------------

describe('buildVerifyRecords', () => {
  it('produces exact match for record with no user-input placeholders', () => {
    const template = { records: [{ type: 'TXT', name: '@', value: 'v=spf1 include:spf.migadu.com -all' }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.match, 'exact')
    assert.equal(r.content, 'v=spf1 include:spf.migadu.com -all')
  })

  it('resolves {DOMAIN} and produces exact match', () => {
    const template = { records: [{ type: 'CNAME', name: 'key1._domainkey', value: 'key1.{DOMAIN}._domainkey.migadu.com' }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.match, 'exact')
    assert.equal(r.content, 'key1.example.com._domainkey.migadu.com')
  })

  it('resolves {DOMAIN_DASHES} and produces exact match', () => {
    const template = { records: [{ type: 'CNAME', name: 'key1._domainkey', value: 'key1.{DOMAIN_DASHES}._domainkey.migadu.com' }] }
    const [r] = buildVerifyRecords(template, 'my.example.com')
    assert.equal(r.match, 'exact')
    assert.equal(r.content, 'key1.my-example-com._domainkey.migadu.com')
  })

  it('produces pattern match for record with user-input placeholder', () => {
    const template = { inputs: [{ flag: 'verifyTxt', name: 'Token' }], records: [{ type: 'TXT', name: '@', value: '{VERIFY_TXT}' }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.match, 'pattern')
    assert.ok(r.pattern instanceof RegExp)
  })

  it('full-placeholder pattern matches any non-empty value', () => {
    const template = { records: [{ type: 'TXT', name: '@', value: '{VERIFY_TXT}' }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.match, 'pattern')
    assert.ok(r.pattern.test('anything'))
    assert.ok(r.pattern.test('hosted-email-verify=abc123'))
  })

  it('prefix-style pattern matches value with correct prefix', () => {
    const template = { records: [{ type: 'TXT', name: '@', value: 'hosted-email-verify={VERIFY_TXT}' }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.match, 'pattern')
    assert.ok(r.pattern.test('hosted-email-verify=abc123'))
    assert.ok(!r.pattern.test('google-site-verification=abc123'))
    assert.ok(!r.pattern.test('hosted-email-verify='))
  })

  it('preserves record type and name', () => {
    const template = { records: [{ type: 'MX', name: '@', value: 'mail.example.com', priority: 10 }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.type, 'MX')
    assert.equal(r.name, '@')
  })

  it('stores display string showing unresolved placeholder for pattern records', () => {
    const template = { records: [{ type: 'TXT', name: '@', value: 'hosted-email-verify={VERIFY_TXT}' }] }
    const [r] = buildVerifyRecords(template, DOMAIN)
    assert.equal(r.match, 'pattern')
    assert.equal(r.display, 'hosted-email-verify={VERIFY_TXT}')
  })
})

// ---------------------------------------------------------------------------
// toFullName
// ---------------------------------------------------------------------------

describe('toFullName', () => {
  it('converts @ to domain', () => {
    assert.equal(toFullName('@', DOMAIN), DOMAIN)
  })

  it('prefixes subdomain with domain', () => {
    assert.equal(toFullName('_dmarc', DOMAIN), `_dmarc.${DOMAIN}`)
  })

  it('handles deep subdomain names', () => {
    assert.equal(toFullName('key1._domainkey', DOMAIN), `key1._domainkey.${DOMAIN}`)
  })
})

// ---------------------------------------------------------------------------
// checkDnsRecord
// ---------------------------------------------------------------------------

function makeResolver(overrides = {}) {
  return {
    resolveMx:    async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) },
    resolveTxt:   async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) },
    resolveCname: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) },
    resolveSrv:   async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) },
    ...overrides,
  }
}

describe('checkDnsRecord', () => {
  describe('MX', () => {
    it('returns true when exchange matches exactly', async () => {
      const vr = { type: 'MX', name: '@', match: 'exact', content: 'mail.example.com' }
      const resolver = makeResolver({ resolveMx: async () => [{ exchange: 'mail.example.com', priority: 10 }] })
      assert.ok(await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('returns true for case-insensitive content match', async () => {
      const vr = { type: 'MX', name: '@', match: 'exact', content: 'MAIL.EXAMPLE.COM' }
      const resolver = makeResolver({ resolveMx: async () => [{ exchange: 'mail.example.com', priority: 10 }] })
      assert.ok(await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('returns false when exchange does not match', async () => {
      const vr = { type: 'MX', name: '@', match: 'exact', content: 'other.example.com' }
      const resolver = makeResolver({ resolveMx: async () => [{ exchange: 'mail.example.com', priority: 10 }] })
      assert.ok(!await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('returns false when DNS lookup throws', async () => {
      const vr = { type: 'MX', name: '@', match: 'exact', content: 'mail.example.com' }
      assert.ok(!await checkDnsRecord(vr, DOMAIN, makeResolver()))
    })
  })

  describe('TXT', () => {
    it('returns true for exact match (joins multi-string records)', async () => {
      const vr = { type: 'TXT', name: '@', match: 'exact', content: 'v=spf1 include:spf.migadu.com -all' }
      const resolver = makeResolver({ resolveTxt: async () => [['v=spf1 include:spf.migadu.com -all']] })
      assert.ok(await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('joins multi-part TXT strings before comparing', async () => {
      const vr = { type: 'TXT', name: '@', match: 'exact', content: 'v=spf1 include:a.com -all' }
      const resolver = makeResolver({ resolveTxt: async () => [['v=spf1 ', 'include:a.com -all']] })
      assert.ok(await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('returns true for pattern match', async () => {
      const vr = { type: 'TXT', name: '@', match: 'pattern', pattern: /^hosted-email-verify=.+$/i, display: 'hosted-email-verify={VERIFY_TXT}' }
      const resolver = makeResolver({ resolveTxt: async () => [['hosted-email-verify=abc123']] })
      assert.ok(await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('returns false when no TXT record matches the pattern', async () => {
      const vr = { type: 'TXT', name: '@', match: 'pattern', pattern: /^hosted-email-verify=.+$/i, display: 'hosted-email-verify={VERIFY_TXT}' }
      const resolver = makeResolver({ resolveTxt: async () => [['google-site-verification=xyz']] })
      assert.ok(!await checkDnsRecord(vr, DOMAIN, resolver))
    })

    it('returns false when DNS lookup throws', async () => {
      const vr = { type: 'TXT', name: '@', match: 'exact', content: 'anything' }
      assert.ok(!await checkDnsRecord(vr, DOMAIN, makeResolver()))
    })
  })

  describe('CNAME', () => {
    it('returns true when CNAME target matches', async () => {
      const vr = { type: 'CNAME', name: 'key1._domainkey', match: 'exact', content: 'key1.example.com._domainkey.migadu.com' }
      const resolver = makeResolver({ resolveCname: async () => ['key1.example.com._domainkey.migadu.com'] })
      assert.ok(await checkDnsRecord(vr, `key1._domainkey.${DOMAIN}`, resolver))
    })

    it('returns false when CNAME target does not match', async () => {
      const vr = { type: 'CNAME', name: 'key1._domainkey', match: 'exact', content: 'key1.example.com._domainkey.migadu.com' }
      const resolver = makeResolver({ resolveCname: async () => ['other.target.com'] })
      assert.ok(!await checkDnsRecord(vr, `key1._domainkey.${DOMAIN}`, resolver))
    })
  })
})
