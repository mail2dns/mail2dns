import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/netlify.js'
import {setConfirmYes} from "./helpers/setConfirm.js";
let setupRecords
const fake = makeServer()

before(async () => {
  process.env.NETLIFY_API_URL = await fake.listen()
  const module = await import('../src/dns-modules/netlify.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const ZONE_ID = 'zone-1'
const INPUTS = { token: 'test-token' }

describe('netlify-specific', () => {
  it('sends records with hostname expanded from domain', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    setConfirmYes()

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].hostname, DOMAIN)
    assert.equal(fake.state.created[0].value, 'mail.example.com')
    assert.equal(fake.state.created[0].priority, 10)
  })

  it('expands subdomain names to full hostname', async () => {
    fake.seedZone(DOMAIN, ZONE_ID)
    setConfirmYes()

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none' }]
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].hostname, `_dmarc.${DOMAIN}`)
  })
})
