import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/digitalocean.js'

let setupRecords
const fake = makeServer()

before(async () => {
  process.env.DIGITALOCEAN_API_URL = await fake.listen()
  const module = await import('../src/dns-modules/digitalocean.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    fake.seedDomain(DOMAIN)
    let mutationsAtConfirm = null

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => {
        mutationsAtConfirm = fake.state.created.length + fake.state.deleted.length
        return false
      }},
      { token: 'tok' }
    )

    assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
    assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => false },
      { token: 'tok' }
    )

    assert.equal(fake.state.created.length, 0)
    assert.equal(fake.state.deleted.length, 0)
  })

  it('creates all records when confirmed', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => true },
      { token: 'tok' }
    )

    assert.equal(fake.state.created.length, RECORDS.length)
    for (const expected of RECORDS) {
      const found = fake.state.created.find(r => r.type === expected.type && r.data === expected.content)
      assert.ok(found, `record not created: ${expected.type} ${expected.content}`)
    }
  })
})

describe('digitalocean-specific', () => {
  it('throws if domain not found', async () => {
    await assert.rejects(
      () => setupRecords(
        { domain: DOMAIN, records: RECORDS, confirm: async () => true },
        { token: 'tok' }
      ),
      /DigitalOcean API error/
    )
  })

  it('removes conflicting MX records before creating', async () => {
    fake.seedDomain(DOMAIN)
    fake.seedRecord(DOMAIN, { id: 1, type: 'MX', name: '@', data: 'old-mx1.example.com', priority: 10 })
    fake.seedRecord(DOMAIN, { id: 2, type: 'MX', name: '@', data: 'old-mx2.example.com', priority: 20 })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10 }],
        confirm: async () => true
      },
      { token: 'tok' }
    )

    assert.ok(fake.state.deleted.includes(1))
    assert.ok(fake.state.deleted.includes(2))
    assert.equal(fake.state.created.length, 1)
    assert.equal(fake.state.created[0].data, 'new-mx.example.com')
  })

  it('removes conflicting SPF record before creating', async () => {
    fake.seedDomain(DOMAIN)
    fake.seedRecord(DOMAIN, { id: 1, type: 'TXT', name: '@', data: 'v=spf1 include:old.example.com ~all' })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all' }],
        confirm: async () => true
      },
      { token: 'tok' }
    )

    assert.ok(fake.state.deleted.includes(1))
    assert.equal(fake.state.created.length, 1)
    assert.ok(fake.state.created[0].data.includes('v=spf1'))
  })
})
