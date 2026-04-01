import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/cloudflare.js'

let setupRecords
const fake = makeServer()

before(async () => {
  process.env.CLOUDFLARE_API_URL = await fake.listen()
  const module = await import('../src/dns-modules/cloudflare.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const ZONE_ID = 'zone-1'
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    let mutationsAtConfirm = null
    fake.seedZone(DOMAIN, ZONE_ID)

    await setupRecords({
      domain: DOMAIN, records: RECORDS, token: 'tok',
      confirm: async () => {
        mutationsAtConfirm = fake.state.created.length + fake.state.deleted.length
        return false
      }
    })

    assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
    assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)

    await setupRecords({
      domain: DOMAIN, records: RECORDS, token: 'tok',
      confirm: async () => false
    })

    assert.equal(fake.state.created.length, 0)
    assert.equal(fake.state.deleted.length, 0)
  })

  it('creates all records when confirmed', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)

    await setupRecords({
      domain: DOMAIN, records: RECORDS, token: 'tok',
      confirm: async () => true
    })

    assert.equal(fake.state.created.length, RECORDS.length)
    for (const expected of RECORDS) {
      const found = fake.state.created.find(r => r.type === expected.type && r.content === expected.content)
      assert.ok(found, `record not created: ${expected.type} ${expected.content}`)
    }
  })
})

describe('cloudflare-specific', () => {
  it('throws if zone not found', async () => {
    await assert.rejects(
      () => setupRecords({
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
        token: 'tok',
        confirm: async () => true
      }),
      /Zone not found for domain/
    )
  })

  it('removes conflicting MX records before creating', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    fake.seedRecord(ZONE_ID, { id: 'mx-old-1', type: 'MX', name: DOMAIN, content: 'old-mx1.example.com', priority: 10 })
    fake.seedRecord(ZONE_ID, { id: 'mx-old-2', type: 'MX', name: DOMAIN, content: 'old-mx2.example.com', priority: 20 })

    await setupRecords({
      domain: DOMAIN,
      records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10 }],
      token: 'tok',
      confirm: async () => true
    })

    assert.ok(fake.state.deleted.includes('mx-old-1'))
    assert.ok(fake.state.deleted.includes('mx-old-2'))
    assert.equal(fake.state.created.length, 1)
    assert.equal(fake.state.created[0].content, 'new-mx.example.com')
  })

  it('removes conflicting SPF record before creating', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    fake.seedRecord(ZONE_ID, { id: 'spf-old', type: 'TXT', name: DOMAIN, content: 'v=spf1 include:old.example.com ~all' })

    await setupRecords({
      domain: DOMAIN,
      records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all' }],
      token: 'tok',
      confirm: async () => true
    })

    assert.ok(fake.state.deleted.includes('spf-old'))
    assert.equal(fake.state.created.length, 1)
    assert.ok(fake.state.created[0].content.includes('v=spf1'))
  })
})
