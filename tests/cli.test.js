import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cli } from './helpers/cli.js'

describe('cli', () => {
  it('exits 0 for --version', async () => {
    const r = await cli(undefined, '--version')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /\d+\.\d+\.\d+/)
  })

  it('exits 0 for --help', async () => {
    const r = await cli(undefined, '--help')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /setup|list|verify/)
  })

  it('exits 1 for unknown command', async () => {
    const r = await cli(undefined, 'notacommand')
    assert.equal(r.status, 1)
  })
})
