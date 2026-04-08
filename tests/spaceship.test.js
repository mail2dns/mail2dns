import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/spaceship.js'

let setupRecords
const fake = makeServer()

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
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 20 }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].value, 'mail.example.com')
    assert.equal(fake.state.created[0].priority, 20)
  })

  it('sends subdomain names as-is', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none' }],
        confirm: async () => true
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].name, '_dmarc')
  })
})
