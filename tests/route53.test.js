import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setupRecords } from '../src/dns-modules/route53.js'
import { makeFake } from './fakes/route53.js'

const fake = makeFake()
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const ZONE_ID = 'Z123456'
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10, ttl: 1 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all', ttl: 1 }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    let changesAtConfirm = null

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, aws: fake.aws, confirm: async () => {
        changesAtConfirm = fake.state.changes.length
        return false
      }},
      {}
    )

    assert.ok(changesAtConfirm !== null, 'confirm was never called')
    assert.equal(changesAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, aws: fake.aws, confirm: async () => false },
      {}
    )

    assert.equal(fake.state.changes.length, 0)
  })

  it('creates all records when confirmed', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, aws: fake.aws, confirm: async () => true },
      {}
    )

    assert.equal(fake.state.upserted.length, 2)
    const mx  = fake.state.upserted.find(s => s.Type === 'MX')
    const txt = fake.state.upserted.find(s => s.Type === 'TXT')
    assert.ok(mx,  'MX record set not created')
    assert.ok(txt, 'TXT record set not created')
  })
})

describe('route53-specific', () => {
  it('throws if hosted zone not found', async () => {
    await assert.rejects(
      () => setupRecords(
        { domain: DOMAIN, records: RECORDS, aws: fake.aws, confirm: async () => true },
        {}
      ),
      /Hosted zone not found for domain/
    )
  })

  it('replaces conflicting MX records', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    fake.seedRecordSet(ZONE_ID, {
      Name: `${DOMAIN}.`, Type: 'MX', TTL: 300,
      ResourceRecords: [
        { Value: '10 old-mx1.example.com.' },
        { Value: '20 old-mx2.example.com.' }
      ]
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10, ttl: 1 }],
        aws: fake.aws,
        confirm: async () => true
      },
      {}
    )

    const mx = fake.state.upserted.find(s => s.Type === 'MX')
    assert.equal(mx.ResourceRecords.length, 1)
    assert.ok(mx.ResourceRecords[0].Value.includes('new-mx.example.com'))
  })

  it('replaces conflicting SPF while preserving other TXT values', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    fake.seedRecordSet(ZONE_ID, {
      Name: `${DOMAIN}.`, Type: 'TXT', TTL: 300,
      ResourceRecords: [
        { Value: '"v=spf1 include:old.example.com ~all"' },
        { Value: '"some-other-verification=keep-me"' }
      ]
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all', ttl: 1 }],
        aws: fake.aws,
        confirm: async () => true
      },
      {}
    )

    const txt = fake.state.upserted.find(s => s.Type === 'TXT')
    const values = txt.ResourceRecords.map(r => r.Value)
    assert.ok(values.some(v => v.includes('new.example.com')),  'new SPF not added')
    assert.ok(values.some(v => v.includes('some-other-verification')), 'unrelated TXT was removed')
    assert.ok(!values.some(v => v.includes('old.example.com')), 'old SPF was not removed')
  })
})
