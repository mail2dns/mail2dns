import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/vercel.js'
import {setConfirmYes} from "./helpers/setConfirm.js";
let setupRecords
const fake = makeServer()

before(async () => {
  process.env.VERCEL_API_URL = await fake.listen()
  const module = await import('../src/dns-modules/vercel.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const INPUTS = { token: 'test-token' }

setConfirmYes()

describe('vercel-specific', () => {
  it('sends @ as empty string for root records', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }]
      },
      INPUTS
    )

    assert.equal(fake.state.created[0].name, '')
    assert.equal(fake.state.created[0].value, 'mail.example.com')
    assert.equal(fake.state.created[0].mxPriority, 10)
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

  it('passes teamId as query param when provided', async () => {
    fake.seedDomain(DOMAIN)

    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }]
      },
      { token: 'test-token', 'team-id': 'team_abc123' }
    )

    assert.equal(fake.state.created.length, 1)
  })
})
