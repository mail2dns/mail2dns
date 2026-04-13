import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeServer } from './fakes/godaddy.js'
import {setConfirmYes} from "./helpers/setConfirm.js";
let setupRecords
const fake = makeServer()

before(async () => {
  process.env.GODADDY_API_URL = await fake.listen()
  const module = await import('../src/dns-modules/godaddy.js')
  setupRecords = module.setupRecords
})

after(() => fake.close())
beforeEach(() => fake.reset())

const DOMAIN = 'example.com'
const INPUTS = { key: 'test-key', secret: 'test-secret' }

describe('godaddy-specific', () => {
  it('sends records with data field instead of content', async () => {
    setConfirmYes()
    await setupRecords(
      {
        domain: DOMAIN,
        records: [{ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 }],
      },
      INPUTS
    )

    assert.equal(fake.state.added[0].data, 'mail.example.com')
    assert.equal(fake.state.added[0].priority, 10)
  })
})
