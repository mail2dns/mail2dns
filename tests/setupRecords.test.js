import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer as makeCloudflare }   from './fakes/cloudflare.js'
import { makeServer as makeDigitalOcean } from './fakes/digitalocean.js'
import { makeServer as makeGodaddy }      from './fakes/godaddy.js'
import { makeServer as makeNetlify }      from './fakes/netlify.js'
import { makeServer as makeVercel }       from './fakes/vercel.js'
import { makeServer as makeSpaceship }    from './fakes/spaceship.js'
import { makeServer as makeHetzner }      from './fakes/hetzner.js'
import {setConfirmNo, setConfirmYes} from "./helpers/setConfirm.js";
import {setConfirm} from "../src/utils.js";
import {writeFileSync} from "fs";
const DOMAIN = 'example.com'
const RECORDS = [
  { type: 'MX',  name: '@', content: 'mail.example.com.', priority: 10 },
  { type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }
]

const providers = [
  (() => {
    const fake = makeCloudflare()
    const ZONE_ID = 'zone-1'
    return {
      name: 'Cloudflare',
      fake,
      envVar: 'CLOUDFLARE_API_URL',
      getEnvUrl: url => url,
      moduleUrl: '../src/dns-modules/cloudflare.js',
      inputs: { token: 'tok' },
      createdKey: 'created',
      contentField: () => 'content',
      seedDomain:       () => fake.seedZone(DOMAIN, ZONE_ID),
      seedMxConflicts:  () => {
        fake.seedRecord(ZONE_ID, { id: 'mx-old-1', type: 'MX', name: DOMAIN, content: 'old-mx1.example.com', priority: 10 })
        fake.seedRecord(ZONE_ID, { id: 'mx-old-2', type: 'MX', name: DOMAIN, content: 'old-mx2.example.com', priority: 20 })
      },
      seedSpfConflict:  () => fake.seedRecord(ZONE_ID, { id: 'spf-old', type: 'TXT', name: DOMAIN, content: 'v=spf1 include:old.example.com ~all' }),
      seedUnrelatedTxt: () => fake.seedRecord(ZONE_ID, { id: 'unrelated', type: 'TXT', name: DOMAIN, content: 'some-other-verification=abc123' }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 2)
        assert.ok(fake.state.deleted.includes('mx-old-1'))
        assert.ok(fake.state.deleted.includes('mx-old-2'))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted.includes('spf-old')),
      seedDmarcConflict:  () => fake.seedRecord(ZONE_ID, { id: 'dmarc-old', type: 'TXT', name: '_dmarc.example.com', content: 'v=DMARC1; p=none' }),
      seedCnameConflict:  () => fake.seedRecord(ZONE_ID, { id: 'email-old', type: 'CNAME', name: 'email.example.com', content: 'old.mailgun.org' }),
      seedUnrelatedDmarc: () => fake.seedRecord(ZONE_ID, { id: 'dmarc-other', type: 'TXT', name: 'other.example.com', content: 'v=DMARC1; p=reject' }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.includes('dmarc-old')),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.includes('email-old')),
      getCreatedValue: r => r.content,
      expectedNewMxValue: 'new-mx.example.com',
      throwsOnMissingDomain: true,
      expectedError: /Zone not found for domain/
    }
  })(),

  (() => {
    const fake = makeDigitalOcean()
    return {
      name: 'DigitalOcean',
      fake,
      envVar: 'DIGITALOCEAN_API_URL',
      getEnvUrl: url => url,
      moduleUrl: '../src/dns-modules/digitalocean.js',
      inputs: { token: 'tok' },
      createdKey: 'created',
      contentField: () => 'data',
      seedDomain:       () => fake.seedDomain(DOMAIN),
      seedMxConflicts:  () => {
        fake.seedRecord(DOMAIN, { id: 1, type: 'MX', name: '@', data: 'old-mx1.example.com', priority: 10 })
        fake.seedRecord(DOMAIN, { id: 2, type: 'MX', name: '@', data: 'old-mx2.example.com', priority: 20 })
      },
      seedSpfConflict:  () => fake.seedRecord(DOMAIN, { id: 1, type: 'TXT', name: '@', data: 'v=spf1 include:old.example.com ~all' }),
      seedUnrelatedTxt: () => fake.seedRecord(DOMAIN, { id: 1, type: 'TXT', name: '@', data: 'some-other-verification=abc123' }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 2)
        assert.ok(fake.state.deleted.includes(1))
        assert.ok(fake.state.deleted.includes(2))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted.includes(1)),
      seedDmarcConflict:  () => fake.seedRecord(DOMAIN, { id: 10, type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none' }),
      seedCnameConflict:  () => fake.seedRecord(DOMAIN, { id: 11, type: 'CNAME', name: 'email', data: 'old.mailgun.org' }),
      seedUnrelatedDmarc: () => fake.seedRecord(DOMAIN, { id: 12, type: 'TXT', name: 'other', data: 'v=DMARC1; p=reject' }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.includes(10)),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.includes(11)),
      getCreatedValue: r => r.data,
      expectedNewMxValue: 'new-mx.example.com.',
      throwsOnMissingDomain: true,
      expectedError: /DigitalOcean API error/
    }
  })(),

  (() => {
    const fake = makeGodaddy()
    return {
      name: 'GoDaddy',
      fake,
      envVar: 'GODADDY_API_URL',
      getEnvUrl: url => url,
      moduleUrl: '../src/dns-modules/godaddy.js',
      inputs: { key: 'test-key', secret: 'test-secret' },
      createdKey: 'added',
      contentField: () => 'data',
      seedDomain:       () => {},
      seedMxConflicts:  () => {
        fake.seedRecord(DOMAIN, { type: 'MX', name: '@', data: 'old-mx1.example.com', priority: 10 })
        fake.seedRecord(DOMAIN, { type: 'MX', name: '@', data: 'old-mx2.example.com', priority: 20 })
      },
      seedSpfConflict:  () => fake.seedRecord(DOMAIN, { type: 'TXT', name: '@', data: 'v=spf1 include:old.example.com ~all' }),
      seedUnrelatedTxt: () => fake.seedRecord(DOMAIN, { type: 'TXT', name: '@', data: 'some-other-verification=abc123' }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 2)
        assert.ok(fake.state.deleted.some(r => r.data === 'old-mx1.example.com'))
        assert.ok(fake.state.deleted.some(r => r.data === 'old-mx2.example.com'))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted[0].data.includes('v=spf1')),
      seedDmarcConflict:  () => fake.seedRecord(DOMAIN, { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none' }),
      seedCnameConflict:  () => fake.seedRecord(DOMAIN, { type: 'CNAME', name: 'email', data: 'old.mailgun.org' }),
      seedUnrelatedDmarc: () => fake.seedRecord(DOMAIN, { type: 'TXT', name: 'other', data: 'v=DMARC1; p=reject' }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === '_dmarc' && r.type === 'TXT')),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === 'email' && r.type === 'CNAME')),
      getCreatedValue: r => r.data,
      expectedNewMxValue: 'new-mx.example.com',
      throwsOnMissingDomain: false
    }
  })(),

  (() => {
    const fake = makeNetlify()
    const ZONE_ID = 'zone-1'
    return {
      name: 'Netlify',
      fake,
      envVar: 'NETLIFY_API_URL',
      getEnvUrl: url => url,
      moduleUrl: '../src/dns-modules/netlify.js',
      inputs: { token: 'tok' },
      createdKey: 'created',
      contentField: () => 'value',
      seedDomain:       () => fake.seedZone(DOMAIN, ZONE_ID),
      seedMxConflicts:  () => {
        fake.seedRecord(ZONE_ID, { id: 'mx-old-1', type: 'MX', hostname: DOMAIN, value: 'old-mx1.example.com', priority: 10 })
        fake.seedRecord(ZONE_ID, { id: 'mx-old-2', type: 'MX', hostname: DOMAIN, value: 'old-mx2.example.com', priority: 20 })
      },
      seedSpfConflict:  () => fake.seedRecord(ZONE_ID, { id: 'spf-old', type: 'TXT', hostname: DOMAIN, value: 'v=spf1 include:old.example.com ~all' }),
      seedUnrelatedTxt: () => fake.seedRecord(ZONE_ID, { id: 'unrelated', type: 'TXT', hostname: DOMAIN, value: 'some-other-verification=abc123' }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 2)
        assert.ok(fake.state.deleted.some(r => r.id === 'mx-old-1'))
        assert.ok(fake.state.deleted.some(r => r.id === 'mx-old-2'))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.id === 'spf-old')),
      seedDmarcConflict:  () => fake.seedRecord(ZONE_ID, { id: 'dmarc-old', type: 'TXT', hostname: '_dmarc.example.com', value: 'v=DMARC1; p=none' }),
      seedCnameConflict:  () => fake.seedRecord(ZONE_ID, { id: 'email-old', type: 'CNAME', hostname: 'email.example.com', value: 'old.mailgun.org' }),
      seedUnrelatedDmarc: () => fake.seedRecord(ZONE_ID, { id: 'dmarc-other', type: 'TXT', hostname: 'other.example.com', value: 'v=DMARC1; p=reject' }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.id === 'dmarc-old')),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.id === 'email-old')),
      getCreatedValue: r => r.value,
      expectedNewMxValue: 'new-mx.example.com',
      throwsOnMissingDomain: true,
      expectedError: /DNS zone not found for domain/
    }
  })(),

  (() => {
    const fake = makeVercel()
    return {
      name: 'Vercel',
      fake,
      envVar: 'VERCEL_API_URL',
      getEnvUrl: url => url,
      moduleUrl: '../src/dns-modules/vercel.js',
      inputs: { token: 'tok' },
      createdKey: 'created',
      contentField: () => 'value',
      seedDomain:       () => fake.seedDomain(DOMAIN),
      seedMxConflicts:  () => {
        fake.seedRecord(DOMAIN, { id: 'mx-old-1', type: 'MX', name: '', value: 'old-mx1.example.com', mxPriority: 10 })
        fake.seedRecord(DOMAIN, { id: 'mx-old-2', type: 'MX', name: '', value: 'old-mx2.example.com', mxPriority: 20 })
      },
      seedSpfConflict:  () => fake.seedRecord(DOMAIN, { id: 'spf-old', type: 'TXT', name: '', value: 'v=spf1 include:old.example.com ~all' }),
      seedUnrelatedTxt: () => fake.seedRecord(DOMAIN, { id: 'unrelated', type: 'TXT', name: '', value: 'some-other-verification=abc123' }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 2)
        assert.ok(fake.state.deleted.some(r => r.id === 'mx-old-1'))
        assert.ok(fake.state.deleted.some(r => r.id === 'mx-old-2'))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.id === 'spf-old')),
      seedDmarcConflict:  () => fake.seedRecord(DOMAIN, { id: 'dmarc-old', type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' }),
      seedCnameConflict:  () => fake.seedRecord(DOMAIN, { id: 'email-old', type: 'CNAME', name: 'email', value: 'old.mailgun.org' }),
      seedUnrelatedDmarc: () => fake.seedRecord(DOMAIN, { id: 'dmarc-other', type: 'TXT', name: 'other', value: 'v=DMARC1; p=reject' }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.id === 'dmarc-old')),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.id === 'email-old')),
      getCreatedValue: r => r.value,
      expectedNewMxValue: 'new-mx.example.com',
      throwsOnMissingDomain: true,
      expectedError: /Vercel API error/
    }
  })(),

  (() => {
    const fake = makeSpaceship()
    return {
      name: 'Spaceship',
      fake,
      envVar: 'SPACESHIP_API_URL',
      getEnvUrl: url => `${url}/v1`,
      moduleUrl: '../src/dns-modules/spaceship.js',
      inputs: { 'api-key': 'test-key', 'api-secret': 'test-secret' },
      createdKey: 'created',
      contentField: (type) => {
        if (type === 'MX') return 'exchange'
        if (type === 'CNAME') return 'cname'
        return 'value'
      },
      seedDomain:       () => fake.seedDomain(DOMAIN),
      seedMxConflicts:  () => {
        fake.seedRecord(DOMAIN, { name: '@', type: 'MX', exchange: 'old-mx1.example.com', preference: 10, ttl: 300 })
        fake.seedRecord(DOMAIN, { name: '@', type: 'MX', exchange: 'old-mx2.example.com', preference: 20, ttl: 300 })
      },
      seedSpfConflict:  () => fake.seedRecord(DOMAIN, { name: '@', type: 'TXT', value: 'v=spf1 include:old.example.com ~all', ttl: 300 }),
      seedUnrelatedTxt: () => fake.seedRecord(DOMAIN, { name: '@', type: 'TXT', value: 'some-other-verification=abc123', ttl: 300 }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 2)
        assert.ok(fake.state.deleted.some(r => r.exchange === 'old-mx1.example.com'))
        assert.ok(fake.state.deleted.some(r => r.exchange === 'old-mx2.example.com'))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted[0].value.includes('v=spf1')),
      seedDmarcConflict:  () => fake.seedRecord(DOMAIN, { name: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none', ttl: 300 }),
      seedCnameConflict:  () => fake.seedRecord(DOMAIN, { name: 'email', type: 'CNAME', cname: 'old.mailgun.org', ttl: 300 }),
      seedUnrelatedDmarc: () => fake.seedRecord(DOMAIN, { name: 'other', type: 'TXT', value: 'v=DMARC1; p=reject', ttl: 300 }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === '_dmarc' && r.type === 'TXT')),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === 'email' && r.type === 'CNAME')),
      getCreatedValue: r => r.value || r.exchange || r.cname,
      expectedNewMxValue: 'new-mx.example.com',
      throwsOnMissingDomain: true,
      expectedError: /Spaceship API error/
    }
  })(),

  (() => {
    const fake = makeHetzner()
    return {
      name: 'Hetzner',
      fake,
      envVar: 'HETZNER_API_URL',
      getEnvUrl: url => `${url}/v1`,
      moduleUrl: '../src/dns-modules/hetzner.js',
      inputs: { token: 'test-token' },
      createdKey: 'created',
      contentField: () => null,  // RRSets — skip per-record content check in confirm test
      seedDomain:       () => fake.seedZone(DOMAIN),
      seedMxConflicts:  () => fake.seedRRSet(DOMAIN, {
        name: '@', type: 'MX', ttl: 300,
        records: [{ value: '10 old-mx1.example.com' }, { value: '20 old-mx2.example.com' }]
      }),
      seedSpfConflict:  () => fake.seedRRSet(DOMAIN, { name: '@', type: 'TXT', ttl: 300, records: [{ value: 'v=spf1 include:old.example.com ~all' }] }),
      seedUnrelatedTxt: () => fake.seedRRSet(DOMAIN, { name: '@', type: 'TXT', ttl: 300, records: [{ value: 'some-other-verification=abc123' }] }),
      verifyMxConflictsDeleted: () => {
        assert.equal(fake.state.deleted.length, 1)
        assert.ok(fake.state.deleted.some(r => r.name === '@' && r.type === 'MX'))
      },
      verifySpfConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === '@' && r.type === 'TXT')),
      seedDmarcConflict:  () => fake.seedRRSet(DOMAIN, { name: '_dmarc', type: 'TXT', ttl: 300, records: [{ value: 'v=DMARC1; p=none' }] }),
      seedCnameConflict:  () => fake.seedRRSet(DOMAIN, { name: 'email', type: 'CNAME', ttl: 300, records: [{ value: 'old.mailgun.org' }] }),
      seedUnrelatedDmarc: () => fake.seedRRSet(DOMAIN, { name: 'other', type: 'TXT', ttl: 300, records: [{ value: 'v=DMARC1; p=reject' }] }),
      verifyDmarcConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === '_dmarc' && r.type === 'TXT')),
      verifyCnameConflictDeleted: () => assert.ok(fake.state.deleted.some(r => r.name === 'email' && r.type === 'CNAME')),
      getCreatedValue: r => r.records[0].value,
      expectedNewMxValue: '10 new-mx.example.com',
      throwsOnMissingDomain: true,
      expectedError: /Hetzner API error/
    }
  })()
]

for (const p of providers) {
  let setupRecords

  describe(p.name, () => {
    before(async () => {
      process.env[p.envVar] = p.getEnvUrl(await p.fake.listen())
      setupRecords = (await import(p.moduleUrl)).setupRecords
    })

    after(() => p.fake.close())
    beforeEach(() => p.fake.reset())

    describe(p.name + ' confirm behaviour', () => {
      it('calls confirm before any mutations', async () => {
        p.seedDomain()
        let mutationsAtConfirm = null
        setConfirm(async () => {
          mutationsAtConfirm = p.fake.state[p.createdKey].length + p.fake.state.deleted.length
          return false
        })

        await setupRecords(
          {
            domain: DOMAIN,
            records: RECORDS
          },
          p.inputs
        )

        assert.ok(mutationsAtConfirm !== null, 'confirm was never called')
        assert.equal(mutationsAtConfirm, 0, 'mutations happened before confirm')
      })

      it('makes no mutations when confirm returns false', async () => {
        p.seedDomain()
        setConfirmNo()

        await setupRecords(
          { domain: DOMAIN, records: RECORDS},
          p.inputs
        )

        assert.equal(p.fake.state[p.createdKey].length, 0)
        assert.equal(p.fake.state.deleted.length, 0)
      })

      it(p.name + ' creates all records when confirmed', async () => {
        p.seedDomain()
        setConfirmYes()

        await setupRecords(
          { domain: DOMAIN, records: RECORDS},
          p.inputs
        )

        const created = p.fake.state[p.createdKey]

        assert.equal(created.length, RECORDS.length)
        if (p.contentField()) {
          for (const expected of RECORDS) {
            const found = created.find(r => r.type === expected.type && r[p.contentField(expected.type)] === expected.content)
            assert.ok(found, `record not created: ${expected.type} ${expected.content}`)
          }
        }
      })
    })

    if (p.throwsOnMissingDomain) {
      it('throws if domain/zone not found', async () => {
        setConfirmYes()
        await assert.rejects(
          () => setupRecords(
            { domain: DOMAIN, records: RECORDS},
            p.inputs
          ),
          p.expectedError
        )
      })
    }

    it(p.name + ' removes conflicting MX records before creating', async () => {
      p.seedDomain()
      p.seedMxConflicts()
      setConfirmYes()

      await setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'MX', name: '@', content: 'new-mx.example.com', priority: 10 }]
        },
        p.inputs
      )

      p.verifyMxConflictsDeleted()
      const created = p.fake.state[p.createdKey]
      assert.equal(created.length, 1)
      assert.equal(p.getCreatedValue(created[0]), p.expectedNewMxValue)

    })

    it(p.name + ' removes conflicting SPF record before creating', async () => {
      p.seedDomain()
      p.seedSpfConflict()
      setConfirmYes()

      await setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:new.example.com ~all' }]
        },
        p.inputs
      )

      p.verifySpfConflictDeleted()
      const created = p.fake.state[p.createdKey]
      assert.equal(created.length, 1)
      assert.ok(p.getCreatedValue(created[0]).includes('v=spf1'))
    })

    it('does not remove unrelated TXT records', async () => {
      p.seedDomain()
      p.seedUnrelatedTxt()
      setConfirmYes()

      await setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'TXT', name: '@', content: 'v=spf1 include:spf.example.com ~all' }]
        },
        p.inputs
      )

      assert.equal(p.fake.state.deleted.length, 0)
      assert.equal(p.fake.state[p.createdKey].length, 1)
    })

    it('removes conflicting DMARC record before creating', async () => {
      p.seedDomain()
      p.seedDmarcConflict()
      setConfirmYes()

      await setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine' }]
        },
        p.inputs
      )

      p.verifyDmarcConflictDeleted()
    })

    it('removes conflicting CNAME record before creating', async () => {
      p.seedDomain()
      p.seedCnameConflict()
      setConfirmYes()

      await setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'CNAME', name: 'email', content: 'mailgun.org' }]
        },
        p.inputs
      )

      p.verifyCnameConflictDeleted()
    })

    it('does not remove DMARC-like TXT at a different name', async () => {
      p.seedDomain()
      p.seedUnrelatedDmarc()
      setConfirmYes()

      await setupRecords(
        {
          domain: DOMAIN,
          records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine' }]
        },
        p.inputs
      )

      assert.equal(p.fake.state.deleted.length, 0)
    })
  })
}
