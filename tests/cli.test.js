import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

function cli(...args) {
  return spawnSync(
    'node',
    ['--import', 'tsx/esm', 'src/cli.ts', ...args],
    { encoding: 'utf8' }
  )
}

describe('cli', () => {
  it('exits 0 for --version', () => {
    const r = cli('--version')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /\d+\.\d+\.\d+/)
  })

  it('exits 0 for --help', () => {
    const r = cli('--help')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /setup|list|verify/)
  })

  it('exits 1 for unknown command', () => {
    const r = cli('notacommand')
    assert.equal(r.status, 1)
  })

  describe('setup', () => {
    it('exits 1 for invalid domain', () => {
      const r = cli('setup', 'notadomain', 'migadu', 'cloudflare')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Invalid domain/)
    })

    it('exits 1 for unknown email provider', () => {
      const r = cli('setup', 'example.com', 'notanemailprovider', 'cloudflare')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Unknown email provider/)
    })

    it('exits 1 for unknown DNS provider', () => {
      const r = cli('setup', 'example.com', 'migadu', 'notadnsprovider')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Unknown DNS provider/)
    })
  })

  describe('list', () => {
    it('exits 1 for invalid domain', () => {
      const r = cli('list', 'notadomain', 'cloudflare')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Invalid domain/)
    })

    it('exits 1 for unknown DNS provider', () => {
      const r = cli('list', 'example.com', 'notadnsprovider')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Unknown DNS provider/)
    })
  })

  describe('verify', () => {
    it('exits 1 for invalid domain', () => {
      const r = cli('verify', 'notadomain', 'migadu')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Invalid domain/)
    })

    it('exits 1 for unknown email provider', () => {
      const r = cli('verify', 'example.com', 'notanemailprovider')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Unknown email provider/)
    })
  })
})
