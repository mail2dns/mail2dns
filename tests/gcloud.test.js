import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setupRecords } from '../src/dns-modules/gcloud.js'
import { makeFake } from './fakes/gcloud.js'

const fake = makeFake()
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const ZONE = 'example-zone'
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10, ttl: 1 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all', ttl: 1 }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    fake.seedZone(ZONE, DOMAIN)
    let mutationsAtConfirm = null

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, gcloud: fake.gcloud, confirm: async () => {
        mutationsAtConfirm = fake.state.mutations.length
        return false
      }},
      {}
    )

    assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
    assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    fake.seedZone(ZONE, DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, gcloud: fake.gcloud, confirm: async () => false },
      {}
    )

    assert.equal(fake.state.mutations.length, 0)
  })

  it('creates all records when confirmed', async () => {
    fake.seedZone(ZONE, DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, gcloud: fake.gcloud, confirm: async () => true },
      {}
    )

    assert.equal(fake.state.created.length, 2)
    const mx  = fake.state.created.find(m => m.type === 'MX')
    const txt = fake.state.created.find(m => m.type === 'TXT')
    assert.ok(mx,  'MX record not created')
    assert.ok(txt, 'TXT record not created')
  })
})

describe('gcloud-specific', () => {
  it('throws if managed zone not found', async () => {
    await assert.rejects(
      () => setupRecords(
        { domain: DOMAIN, records: RECORDS, gcloud: fake.gcloud, confirm: async () => true },
        {}
      ),
      /Managed zone not found for domain/
    )
  })

  it('replaces conflicting MX records', async () => {
    fake.seedZone(ZONE, DOMAIN)
    fake.seedRecordSet(ZONE, {
      name: `${DOMAIN}.`, type: 'MX', ttl: 300,
      rrdatas: ['10 old-mx1.example.com.', '20 old-mx2.example.com.']
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10, ttl: 1 }],
        gcloud: fake.gcloud,
        confirm: async () => true
      },
      {}
    )

    const mx = fake.state.mutations.find(m => m.type === 'MX')
    assert.equal(mx.rrdatas.length, 1)
    assert.ok(mx.rrdatas[0].includes('new-mx.example.com'))
    assert.equal(mx.cmd, 'update')
  })

  it('replaces conflicting SPF while preserving other TXT values', async () => {
    fake.seedZone(ZONE, DOMAIN)
    fake.seedRecordSet(ZONE, {
      name: `${DOMAIN}.`, type: 'TXT', ttl: 300,
      rrdatas: ['"v=spf1 include:old.example.com ~all"', '"some-other-verification=keep-me"']
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all', ttl: 1 }],
        gcloud: fake.gcloud,
        confirm: async () => true
      },
      {}
    )

    const txt = fake.state.mutations.find(m => m.type === 'TXT')
    assert.ok(txt.rrdatas.some(v => v.includes('new.example.com')),           'new SPF not added')
    assert.ok(txt.rrdatas.some(v => v.includes('some-other-verification')),   'unrelated TXT was removed')
    assert.ok(!txt.rrdatas.some(v => v.includes('old.example.com')),          'old SPF was not removed')
    assert.equal(txt.cmd, 'update')
  })

  it('uses create when no existing record set', async () => {
    fake.seedZone(ZONE, DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none;', ttl: 1 }],
        gcloud: fake.gcloud,
        confirm: async () => true
      },
      {}
    )

    const dmarc = fake.state.mutations.find(m => m.type === 'TXT')
    assert.equal(dmarc.cmd, 'create')
  })

  it('appends --project to all commands when project is set', async () => {
    const calls = []
    const trackingGcloud = (args) => {
      calls.push(args)
      return fake.gcloud(args.filter(a => a !== '--project' && a !== 'my-project'))
    }
    fake.seedZone(ZONE, DOMAIN)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, gcloud: trackingGcloud, confirm: async () => false },
      { project: 'my-project' }
    )

    assert.ok(calls.every(c => c.includes('--project') && c.includes('my-project')),
      'Not all calls included --project')
  })
})
