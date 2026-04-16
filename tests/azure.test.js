import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setupRecords } from '../src/dns-modules/azure.js'
import { makeFake } from './fakes/azure.js'
import { setConfirm } from '../src/utils.js'
import {setConfirmYes} from "./helpers/setConfirm.js";

const fake = makeFake()

beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const RG = 'my-rg'
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com', priority: 10, ttl: 1 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all', ttl: 1 }
]

describe('confirm behaviour', () => {
  it('calls confirm before any mutations', async () => {
    setConfirm(async () => {
      mutationsAtConfirm = fake.state.mutations.length
      return false
    })
    fake.seedZone(DOMAIN, RG)
    let mutationsAtConfirm = null

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, az: fake.az},
      {}
    )

    assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
    assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
  })

  it('makes no mutations when confirm returns false', async () => {
    setConfirm(async () => false)
    fake.seedZone(DOMAIN, RG)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, az: fake.az },
      {}
    )

    assert.equal(fake.state.mutations.length, 0)
  })

  it('creates all records when confirmed', async () => {
    setConfirmYes()
    fake.seedZone(DOMAIN, RG)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, az: fake.az, confirm: async () => true },
      {}
    )

    assert.equal(fake.state.added.length, 2)
    const mx  = fake.state.added.find(m => m.type === 'MX')
    const txt = fake.state.added.find(m => m.type === 'TXT')
    assert.ok(mx,  'MX record not created')
    assert.ok(txt, 'TXT record not created')
  })
})

describe('azure-specific', () => {
  it('throws if DNS zone not found', async () => {
    await assert.rejects(
      () => setupRecords(
        { domain: DOMAIN, records: RECORDS, az: fake.az, confirm: async () => true },
        {}
      ),
      /DNS zone not found for domain/
    )
  })

  it('replaces conflicting MX records', async () => {
    setConfirmYes()
    fake.seedZone(DOMAIN, RG)
    fake.seedRecordSet(DOMAIN, {
      name: '@', type: 'Microsoft.Network/dnszones/MX', TTL: 300,
      MXRecords: [{ preference: 10, exchange: 'old-mx.example.com.' }]
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10, ttl: 1 }],
        az: fake.az,
      },
      {}
    )

    assert.equal(fake.state.removed.length, 1, 'old MX not removed')
    assert.equal(fake.state.added.length, 1, 'new MX not added')
    assert.ok(fake.state.added[0].args.includes('new-mx.example.com.'), 'new MX value wrong')
  })

  it('replaces conflicting DMARC record', async () => {
    fake.seedZone(DOMAIN, RG)
    fake.seedRecordSet(DOMAIN, {
      name: '_dmarc', type: 'Microsoft.Network/dnszones/TXT', TTL: 300,
      TXTRecords: [{ value: ['v=DMARC1; p=none'] }]
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine', ttl: 1 }],
        az: fake.az,
        confirm: async () => true
      },
      {}
    )

    assert.ok(fake.state.removed.some(m => m.type === 'TXT' && m.name === '_dmarc'), 'old DMARC not removed')
    assert.ok(fake.state.added.some(m => m.type === 'TXT' && m.name === '_dmarc'), 'new DMARC not added')
  })

  it('replaces conflicting CNAME record', async () => {
    fake.seedZone(DOMAIN, RG)
    fake.seedRecordSet(DOMAIN, {
      name: 'email', type: 'Microsoft.Network/dnszones/CNAME', TTL: 300,
      CNAMERecord: { cname: 'old.mailgun.org.' }
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'CNAME', name: 'email', content: 'mailgun.org', ttl: 1 }],
        az: fake.az,
        confirm: async () => true
      },
      {}
    )

    assert.ok(fake.state.added.some(m => m.type === 'CNAME' && m.name === 'email'), 'new CNAME not added')
  })

  it('does not remove DMARC-like TXT at a different name', async () => {
    fake.seedZone(DOMAIN, RG)
    fake.seedRecordSet(DOMAIN, {
      name: 'other', type: 'Microsoft.Network/dnszones/TXT', TTL: 300,
      TXTRecords: [{ value: ['v=DMARC1; p=reject'] }]
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine', ttl: 1 }],
        az: fake.az,
        confirm: async () => true
      },
      {}
    )

    assert.equal(fake.state.removed.length, 0)
  })

  it('replaces conflicting SPF while preserving other TXT values', async () => {
    fake.seedZone(DOMAIN, RG)
    fake.seedRecordSet(DOMAIN, {
      name: '@', type: 'Microsoft.Network/dnszones/TXT', TTL: 300,
      TXTRecords: [
        { value: ['v=spf1 include:old.example.com ~all'] },
        { value: ['some-other-verification=keep-me'] }
      ]
    })

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all', ttl: 1 }],
        az: fake.az,
        confirm: async () => true
      },
      {}
    )

    assert.equal(fake.state.removed.length, 1, 'old SPF not removed')
    assert.ok(fake.state.removed[0].args.includes('v=spf1 include:old.example.com ~all'), 'wrong record removed')
    assert.equal(fake.state.added.length, 1, 'new SPF not added')
    assert.ok(fake.state.added[0].args.includes('v=spf1 include:new.example.com ~all'), 'new SPF value wrong')
  })

  it('uses set-record for CNAME', async () => {
    fake.seedZone(DOMAIN, RG)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'CNAME', name: 'mail._domainkey', content: 'dkim.example.com', ttl: 1 }],
        az: fake.az,
        confirm: async () => true
      },
      {}
    )

    const op = fake.state.added.find(m => m.type === 'CNAME')
    assert.ok(op, 'CNAME not created')
    assert.equal(op.action, 'set-record')
  })

  it('prepends --subscription to all commands when subscription is set', async () => {
    const calls = []
    const trackingAz = (args) => {
      calls.push(args)
      return fake.az(args.filter((_, i) => !(args[i - 1] === '--subscription') && args[i] !== '--subscription'))
    }
    fake.seedZone(DOMAIN, RG)

    await setupRecords(
      { domain: DOMAIN, records: RECORDS, az: trackingAz, confirm: async () => false },
      { subscription: 'my-sub-id' }
    )

    assert.ok(calls.every(c => c[0] === '--subscription' && c[1] === 'my-sub-id'),
      'Not all calls included --subscription')
  })
})
