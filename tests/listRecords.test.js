import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer as makeCloudflare }   from './fakes/cloudflare.js'
import { makeServer as makeDigitalOcean } from './fakes/digitalocean.js'
import { makeServer as makeGodaddy }      from './fakes/godaddy.js'
import { makeServer as makeNetlify }      from './fakes/netlify.js'
import { makeServer as makeVercel }       from './fakes/vercel.js'
import { makeServer as makeSpaceship }    from './fakes/spaceship.js'
import { makeServer as makeHetzner }      from './fakes/hetzner.js'
const DOMAIN = 'example.com'

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
      seedDomain:       () => fake.seedZone(DOMAIN, ZONE_ID),
      seedMxRecord:     () => fake.seedRecord(ZONE_ID, { id: '1', type: 'MX',  name: DOMAIN,              content: 'mail.example.com', priority: 10 }),
      seedSubdomainTxt: () => fake.seedRecord(ZONE_ID, { id: '2', type: 'TXT', name: `_dmarc.${DOMAIN}`,  content: 'v=DMARC1; p=none;' }),
      seedARecord:      () => fake.seedRecord(ZONE_ID, { id: '3', type: 'A',   name: DOMAIN,              content: '1.2.3.4' }),
      // seed 110 A records (fills page 1 of 100) + 1 MX on page 2
      seedManyRecords:  () => {
        for (let i = 0; i < 110; i++) {
          fake.seedRecord(ZONE_ID, { id: `bulk-${i}`, type: 'A', name: `sub${i}.${DOMAIN}`, content: `1.2.3.${i % 256}` })
        }
        fake.seedRecord(ZONE_ID, { id: 'mx-last', type: 'MX', name: DOMAIN, content: 'mail.example.com', priority: 10 })
      },
      throwsOnMissingDomain: true,
      expectedError: /Zone not found for domain/,
      supportsPagination: true
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
      seedDomain:       () => fake.seedDomain(DOMAIN),
      seedMxRecord:     () => fake.seedRecord(DOMAIN, { id: 1, type: 'MX',  name: '@',      data: 'mail.example.com', priority: 10 }),
      seedSubdomainTxt: () => fake.seedRecord(DOMAIN, { id: 2, type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none;' }),
      seedARecord:      () => fake.seedRecord(DOMAIN, { id: 3, type: 'A',   name: '@',      data: '1.2.3.4' }),
      // seed 210 A records (fills page 1 of 200) + 1 MX on page 2
      seedManyRecords:  () => {
        for (let i = 0; i < 210; i++) {
          fake.seedRecord(DOMAIN, { id: 100 + i, type: 'A', name: `sub${i}`, data: `1.2.3.${i % 256}` })
        }
        fake.seedRecord(DOMAIN, { id: 9999, type: 'MX', name: '@', data: 'mail.example.com', priority: 10 })
      },
      throwsOnMissingDomain: false,
      supportsPagination: true
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
      seedDomain:       () => {},
      seedMxRecord:     () => fake.seedRecord(DOMAIN, { type: 'MX',  name: '@',      data: 'mail.example.com', priority: 10 }),
      seedSubdomainTxt: () => fake.seedRecord(DOMAIN, { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none;' }),
      seedARecord:      () => fake.seedRecord(DOMAIN, { type: 'A',   name: '@',      data: '1.2.3.4' }),
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
      seedDomain:       () => fake.seedZone(DOMAIN, ZONE_ID),
      seedMxRecord:     () => fake.seedRecord(ZONE_ID, { id: '1', type: 'MX',  hostname: DOMAIN,             value: 'mail.example.com', priority: 10 }),
      seedSubdomainTxt: () => fake.seedRecord(ZONE_ID, { id: '2', type: 'TXT', hostname: `_dmarc.${DOMAIN}`, value: 'v=DMARC1; p=none;' }),
      seedARecord:      () => fake.seedRecord(ZONE_ID, { id: '3', type: 'A',   hostname: DOMAIN,             value: '1.2.3.4' }),
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
      seedDomain:       () => fake.seedDomain(DOMAIN),
      seedMxRecord:     () => fake.seedRecord(DOMAIN, { id: '1', type: 'MX',  name: '',       value: 'mail.example.com', mxPriority: 10 }),
      seedSubdomainTxt: () => fake.seedRecord(DOMAIN, { id: '2', type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none;' }),
      seedARecord:      () => fake.seedRecord(DOMAIN, { id: '3', type: 'A',   name: '',       value: '1.2.3.4' }),
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
      seedDomain:       () => fake.seedDomain(DOMAIN),
      seedMxRecord:     () => fake.seedRecord(DOMAIN, { name: '@',      type: 'MX',  exchange: 'mail.example.com', preference: 10,  ttl: 300 }),
      seedSubdomainTxt: () => fake.seedRecord(DOMAIN, { name: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none;',              ttl: 300 }),
      seedARecord:      () => fake.seedRecord(DOMAIN, { name: '@',      type: 'A',   address: '1.2.3.4',                        ttl: 300 }),
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
      seedDomain:       () => fake.seedZone(DOMAIN),
      seedMxRecord:     () => fake.seedRRSet(DOMAIN, { name: '@',      type: 'MX',  ttl: 300, records: [{ value: '10 mail.example.com.' }] }),
      seedSubdomainTxt: () => fake.seedRRSet(DOMAIN, { name: '_dmarc', type: 'TXT', ttl: 300, records: [{ value: 'v=DMARC1; p=none;' }] }),
      seedARecord:      () => fake.seedRRSet(DOMAIN, { name: '@',      type: 'A',   ttl: 300, records: [{ value: '1.2.3.4' }] }),
      throwsOnMissingDomain: true,
      expectedError: /Hetzner API error/
    }
  })()
]

for (const p of providers) {
  let listRecords

  describe(p.name, () => {
    before(async () => {
      process.env[p.envVar] = p.getEnvUrl(await p.fake.listen())
      const module = await import(p.moduleUrl)
      listRecords = module.listRecords
    })

    after(() => p.fake.close())
    beforeEach(() => p.fake.reset())

    it('returns empty array when no records exist', async () => {
      p.seedDomain()
      const records = await listRecords(DOMAIN, p.inputs)
      assert.deepEqual(records, [])
    })

    if (p.throwsOnMissingDomain) {
      it('throws if domain/zone not found', async () => {
        await assert.rejects(() => listRecords(DOMAIN, p.inputs), p.expectedError)
      })
    }

    it('returns MX record with name @, correct content and priority', async () => {
      p.seedDomain()
      p.seedMxRecord()

      const records = await listRecords(DOMAIN, p.inputs)
      assert.equal(records.length, 1)
      assert.equal(records[0].type, 'MX')
      assert.equal(records[0].name, '@')
      assert.equal(records[0].content, 'mail.example.com')
      assert.equal(records[0].priority, 10)
    })

    it('returns subdomain TXT record with normalised name', async () => {
      p.seedDomain()
      p.seedSubdomainTxt()

      const records = await listRecords(DOMAIN, p.inputs)
      assert.equal(records.length, 1)
      assert.equal(records[0].type, 'TXT')
      assert.equal(records[0].name, '_dmarc')
      assert.equal(records[0].content, 'v=DMARC1; p=none;')
    })

    it('filters out non-mail record types', async () => {
      p.seedDomain()
      p.seedARecord()
      p.seedMxRecord()

      const records = await listRecords(DOMAIN, p.inputs)
      assert.equal(records.length, 1)
      assert.equal(records[0].type, 'MX')
    })

    if (p.supportsPagination) {
      it('fetches all records across multiple pages', async () => {
        p.seedDomain()
        p.seedManyRecords()

        const records = await listRecords(DOMAIN, p.inputs)
        const mxRecords = records.filter(r => r.type === 'MX')
        assert.equal(mxRecords.length, 1, 'MX record from second page should be returned')
      })
    }
  })
}
