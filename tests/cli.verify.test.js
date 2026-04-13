import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import { cli } from './helpers/cli.js'

const DOMAIN = 'example.com'

describe('verify', () => {
  it('exits 1 for invalid domain', async () => {
    const r = await cli(undefined, 'verify', 'notadomain', 'migadu')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Invalid domain/)
  })

  it('exits 1 for unknown email provider', async () => {
    const r = await cli(undefined, 'verify', DOMAIN, 'notanemailprovider')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Unknown email provider/)
  })
})
