import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/spaceship.js'

let setupRecords
const fake = makeServer()

before(async () => {
  process.env.SPACESHIP_API_URL = `${await fake.listen()}/v1`
  const module = await import('../src/dns-modules/spaceship.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const INPUTS = { 'api-key': 'test-key', 'api-secret': 'test-secret' }
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    let mutationsAtConfirm = null
    fake.seedDomain(DOMAIN)

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
    fake.seedDomain(DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => false },
      INPUTS
    )

    assert.equal(fake.state.created.length, 0)
    assert.equal(fake.state.deleted.length, 0)
  })

  it('creates all records when confirmed', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => true },
      INPUTS
    )

    assert.equal(fake.state.created.length, RECORDS.length)
    for (const expected of RECORDS) {
      const found = fake.state.created.find(r => r.type === expected.type && r.value === expected.content)
      assert.ok(found, `record not created: ${expected.type} ${expected.content}`)
    }
  })
})

describe('spaceship-specific', () => {
  it('throws if domain not found', async () => {
    await assert.rejects(
      () => setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
          confirm: async () => true
        },
        INPUTS
      ),
      /Spaceship API error/
    )
  })

  it('removes conflicting MX records before creating', async () => {
    fake.seedDomain(DOMAIN)
    fake.seedRecord(DOMAIN, { name: '@', type: 'MX', value: 'old-mx1.example.com', priority: 10, ttl: 300 })
    fake.seedRecord(DOMAIN, { name: '@', type: 'MX', value: 'old-mx2.example.com', priority: 20, ttl: 300 })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.ok(fake.state.deleted.some(r => r.value === 'old-mx1.example.com'))
    assert.ok(fake.state.deleted.some(r => r.value === 'old-mx2.example.com'))
    assert.equal(fake.state.created.length, 1)
    assert.equal(fake.state.created[0].value, 'new-mx.example.com')
  })

  it('removes conflicting SPF record before creating', async () => {
    fake.seedDomain(DOMAIN)
    fake.seedRecord(DOMAIN, { name: '@', type: 'TXT', value: 'v=spf1 include:old.example.com ~all', ttl: 300 })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.ok(fake.state.deleted.some(r => r.value.includes('v=spf1')))
    assert.equal(fake.state.created.length, 1)
    assert.ok(fake.state.created[0].value.includes('v=spf1'))
  })

  it('does not remove unrelated TXT records', async () => {
    fake.seedDomain(DOMAIN)
    fake.seedRecord(DOMAIN, { name: '@', type: 'TXT', value: 'some-other-verification=abc123', ttl: 300 })

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

  it('sends MX priority as a separate field', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 20 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].value, 'mail.example.com')
    assert.equal(fake.state.created[0].priority, 20)
  })

  it('sends subdomain names as-is', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].name, '_dmarc')
  })
})
