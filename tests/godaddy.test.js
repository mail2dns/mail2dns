import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/godaddy.js'

let setupRecords
const fake = makeServer()

before(async () => {
  process.env.GODADDY_API_URL = await fake.listen()
  const module = await import('../src/dns-modules/godaddy.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const INPUTS = { key: 'test-key', secret: 'test-secret' }
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    let mutationsAtConfirm = null

    await setupRecords(
      {
        domain: DOMAIN,
        records: RECORDS,
        confirm: async () => {
          mutationsAtConfirm = fake.state.added.length + fake.state.deleted.length
          return false
        }
      },
      INPUTS
    )

    assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
    assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => false },
      INPUTS
    )

    assert.equal(fake.state.added.length, 0)
    assert.equal(fake.state.deleted.length, 0)
  })

  it('creates all records when confirmed', async () => {
    await setupRecords(
      { domain: DOMAIN, records: RECORDS, confirm: async () => true },
      INPUTS
    )

    assert.equal(fake.state.added.length, RECORDS.length)
    for (const expected of RECORDS) {
      const found = fake.state.added.find(r => r.type === expected.type && r.data === expected.content)
      assert.ok(found, `record not created: ${expected.type} ${expected.content}`)
    }
  })
})

describe('godaddy-specific', () => {
  it('removes conflicting MX records before creating', async () => {
    fake.seedRecord(DOMAIN, { type: 'MX', name: '@', data: 'old-mx1.example.com', priority: 10 })
    fake.seedRecord(DOMAIN, { type: 'MX', name: '@', data: 'old-mx2.example.com', priority: 20 })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.deleted.length, 2)
    assert.ok(fake.state.deleted.some(r => r.data === 'old-mx1.example.com'))
    assert.ok(fake.state.deleted.some(r => r.data === 'old-mx2.example.com'))
    assert.equal(fake.state.added.length, 1)
    assert.equal(fake.state.added[0].data, 'new-mx.example.com')
  })

  it('removes conflicting SPF record before creating', async () => {
    fake.seedRecord(DOMAIN, { type: 'TXT', name: '@', data: 'v=spf1 include:old.example.com ~all' })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.deleted.length, 1)
    assert.ok(fake.state.deleted[0].data.includes('v=spf1'))
    assert.equal(fake.state.added.length, 1)
    assert.ok(fake.state.added[0].data.includes('v=spf1'))
  })

  it('does not remove unrelated TXT records', async () => {
    fake.seedRecord(DOMAIN, { type: 'TXT', name: '@', data: 'some-other-verification=abc123' })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.deleted.length, 0)
    assert.equal(fake.state.added.length, 1)
  })

  it('sends records with data field instead of content', async () => {
    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.added[0].data, 'mail.example.com')
    assert.equal(fake.state.added[0].priority, 10)
  })
})
