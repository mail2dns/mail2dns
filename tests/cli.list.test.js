import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer as makeCloudflare } from './fakes/cloudflare.js'
import { cli } from './helpers/cli.js'

const DOMAIN = 'example.com'
const ZONE_ID = 'zone-1'

describe('list', () => {
  it('exits 1 for invalid domain', async () => {
    const r = await cli(undefined, 'list', 'notadomain', 'cloudflare')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Invalid domain/)
  })

  it('exits 1 for unknown DNS provider', async () => {
    const r = await cli(undefined, 'list', DOMAIN, 'notadnsprovider')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Unknown DNS provider/)
  })

  describe('cloudflare', () => {
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

    it('outputs records created by setup', async () => {
      await cli(env,
        'setup', DOMAIN, 'migadu', 'cloudflare',
        '--yes', '--verify-txt', 'hosted-email-verify=abc123'
      )

      const r = await cli(env, 'list', DOMAIN, 'cloudflare')
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /MX/)
      assert.match(r.stdout, /migadu/)
      assert.match(r.stdout, /v=spf1/)
      assert.match(r.stdout, /v=DMARC1/)
    })
  })
})
