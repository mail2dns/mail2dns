import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/hetzner.js'

let setupRecords
const fake = makeServer()

before(async () => {
  process.env.HETZNER_API_URL = (await fake.listen()) + '/v1'
  const module = await import('../src/dns-modules/hetzner.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const INPUTS = { token: 'test-token' }

describe('hetzner-specific', () => {
  it('formats MX record value with priority inline', async () => {
    fake.seedZone(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].records[0].value, '10 mail.example.com')
  })

  it('groups multiple MX records into a single RRSet', async () => {
    fake.seedZone(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [
          { type: 'MX', name: '@', content: 'mx1.example.com', priority: 10 },
          { type: 'MX', name: '@', content: 'mx2.example.com', priority: 20 }
        ],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.created.length, 1)
    assert.equal(fake.state.created[0].type, 'MX')
    assert.equal(fake.state.created[0].records.length, 2)
  })

  it('removes conflicting DKIM RRSet before creating', async () => {
    fake.seedZone(DOMAIN)
    fake.seedRRSet(DOMAIN, { name: 'selector._domainkey', type: 'CNAME', ttl: 300, records: [{ value: 'old.dkim.example.com' }] })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'CNAME', name: 'selector._domainkey', content: 'new.dkim.example.com' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.ok(fake.state.deleted.some(r => r.name === 'selector._domainkey' && r.type === 'CNAME'))
    assert.equal(fake.state.created.length, 1)
  })
})
