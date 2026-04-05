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
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    let mutationsAtConfirm = null
    fake.seedZone(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: RECORDS,
        confirm: async () => {
          mutationsAtConfirm = fake.state.created.length + fake.state.deleted.length
          return false
        }
      },
      INPUTS
    )

    assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
    assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    fake.seedZone(DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => false },
      INPUTS
    )

    assert.equal(fake.state.created.length, 0)
    assert.equal(fake.state.deleted.length, 0)
  })

  it('creates all records when confirmed', async () => {
    fake.seedZone(DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => true },
      INPUTS
    )

    // 2 records → 2 RRSets (@/MX and @/TXT)
    assert.equal(fake.state.created.length, 2)
  })
})

describe('hetzner-specific', () => {
  it('throws if zone not found', async () => {
    await assert.rejects(
      () => setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
          confirm: async () => true
        },
        INPUTS
      ),
      /Hetzner API error/
    )
  })

  it('removes conflicting MX RRSet before creating', async () => {
    fake.seedZone(DOMAIN)
    fake.seedRRSet(DOMAIN, { name: '@', type: 'MX', ttl: 300, records: [{ value: '10 old-mx.example.com' }] })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 20 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.ok(fake.state.deleted.some(r => r.name === '@' && r.type === 'MX'))
    assert.equal(fake.state.created.length, 1)
    assert.equal(fake.state.created[0].records[0].value, '20 new-mx.example.com')
  })

  it('removes conflicting SPF RRSet before creating', async () => {
    fake.seedZone(DOMAIN)
    fake.seedRRSet(DOMAIN, { name: '@', type: 'TXT', ttl: 300, records: [{ value: 'v=spf1 include:old.example.com ~all' }] })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.ok(fake.state.deleted.some(r => r.name === '@' && r.type === 'TXT'))
    assert.equal(fake.state.created.length, 1)
    assert.ok(fake.state.created[0].records[0].value.includes('v=spf1'))
  })

  it('does not remove unrelated TXT RRSets', async () => {
    fake.seedZone(DOMAIN)
    fake.seedRRSet(DOMAIN, { name: '@', type: 'TXT', ttl: 300, records: [{ value: 'some-other-verification=abc123' }] })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.deleted.length, 0)
    assert.equal(fake.state.created.length, 1)
  })

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
