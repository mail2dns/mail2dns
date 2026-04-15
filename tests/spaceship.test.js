import {describe, it, before, after, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/spaceship.js'
import {setConfirmYes} from "./helpers/setConfirm.js";

let setupRecords
const fake = makeServer()
setConfirmYes()

before(async () => {
  process.env.SPACESHIP_API_URL = `${await fake.listen()}/v1`
  const module = await import('../src/dns-modules/spaceship.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const INPUTS = { 'api-key': 'test-key', 'api-secret': 'test-secret' }

describe('spaceship-specific', () => {
  it('sends MX priority as a separate field', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 20 }]
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].exchange, 'mail.example.com')
    assert.equal(fake.state.created[0].preference, 20)
  })

  it('sends subdomain names as-is', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none' }]
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].name, '_dmarc')
  })
})
