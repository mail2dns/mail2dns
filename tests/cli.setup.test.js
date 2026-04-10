import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer as makeCloudflare } from './fakes/cloudflare.js'
import { cli } from './helpers/cli.js'

const DOMAIN = 'example.com'
const ZONE_ID = 'zone-1'

describe('setup', () => {
  it('exits 1 for invalid domain', async () => {
    const r = await cli(undefined, 'setup', 'notadomain', 'migadu', 'cloudflare')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Invalid domain/)
  })

  it('exits 1 for unknown email provider', async () => {
    const r = await cli(undefined, 'setup', DOMAIN, 'notanemailprovider', 'cloudflare')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Unknown email provider/)
  })

  it('exits 1 for unknown DNS provider', async () => {
    const r = await cli(undefined, 'setup', DOMAIN, 'migadu', 'notadnsprovider')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Unknown DNS provider/)
  })

  describe('migadu + cloudflare', () => {
    const fake = makeCloudflare()
    let env

    before(async () => {
      env = { CLOUDFLARE_API_URL: await fake.listen(), CLOUDFLARE_API_TOKEN: 'tok' }
    })

    after(() => fake.close())

    beforeEach(() => {
      fake.reset()
      fake.seedZone(DOMAIN, ZONE_ID)
    })

    it('creates all expected record types', async () => {
      const r = await cli(env,
        'setup', DOMAIN, 'migadu', 'cloudflare',
        '--yes', '--verify-txt', 'hosted-email-verify=abc123'
      )
      assert.equal(r.status, 0, r.stderr)
      const created = fake.state.created
      assert.ok(created.some(r => r.type === 'MX' && r.content === 'aspmx1.migadu.com'), 'primary MX')
      assert.ok(created.some(r => r.type === 'TXT' && r.content === 'hosted-email-verify=abc123'), 'verify TXT')
      assert.ok(created.some(r => r.type === 'TXT' && r.content.includes('v=spf1')), 'SPF')
      assert.ok(created.some(r => r.type === 'TXT' && r.content.includes('v=DMARC1')), 'DMARC')
      assert.ok(created.some(r => r.type === 'CNAME' && r.name.includes('_domainkey')), 'DKIM CNAME')
    })

    it('defaults DMARC policy to none', async () => {
      const r = await cli(env,
        'setup', DOMAIN, 'migadu', 'cloudflare',
        '--yes', '--verify-txt', 'hosted-email-verify=abc123'
      )
      assert.equal(r.status, 0, r.stderr)
      const dmarc = fake.state.created.find(r => r.type === 'TXT' && r.content.includes('v=DMARC1'))
      assert.ok(dmarc?.content.includes('p=none'), `expected p=none in "${dmarc?.content}"`)
    })

    it('respects --dmarc-policy', async () => {
      const r = await cli(env,
        'setup', DOMAIN, 'migadu', 'cloudflare',
        '--yes', '--verify-txt', 'hosted-email-verify=abc123',
        '--dmarc-policy', 'reject'
      )
      assert.equal(r.status, 0, r.stderr)
      const dmarc = fake.state.created.find(r => r.type === 'TXT' && r.content.includes('v=DMARC1'))
      assert.ok(dmarc?.content.includes('p=reject'), `expected p=reject in "${dmarc?.content}"`)
    })

    it('skips MX records with --no-mx', async () => {
      const r = await cli(env,
        'setup', DOMAIN, 'migadu', 'cloudflare',
        '--yes', '--verify-txt', 'hosted-email-verify=abc123',
        '--no-mx'
      )
      assert.equal(r.status, 0, r.stderr)
      assert.ok(!fake.state.created.some(r => r.type === 'MX'), 'no MX records created')
    })

    it('exits 1 when a required provider input is missing in --yes mode', async () => {
      const r = await cli(env,
        'setup', DOMAIN, 'migadu', 'cloudflare',
        '--yes'
      )
      assert.equal(r.status, 1)
      assert.match(r.stderr, /required/)
    })
  })
})
