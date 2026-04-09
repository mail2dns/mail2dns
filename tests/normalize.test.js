import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecords as normalizeRoute53 } from '../src/dns-modules/route53.js'
import { normalizeRecords as normalizeGcloud } from '../src/dns-modules/gcloud.js'
import { normalizeRecords as normalizeHetzner } from '../src/dns-modules/hetzner.js'
import { normalizeRecords as normalizeAzure } from '../src/dns-modules/azure.js'

const DOMAIN = 'example.com'

// ---------------------------------------------------------------------------
// Route 53
// ---------------------------------------------------------------------------

describe('route53 normalizeRecords', () => {
  it('filters out non-mail types (A, NS, SOA)', () => {
    const sets = [
      { Name: 'example.com.', Type: 'A',   TTL: 300, ResourceRecords: [{ Value: '1.2.3.4' }] },
      { Name: 'example.com.', Type: 'NS',  TTL: 300, ResourceRecords: [{ Value: 'ns1.example.com.' }] },
      { Name: 'example.com.', Type: 'SOA', TTL: 300, ResourceRecords: [{ Value: 'ns1.example.com.' }] },
    ]
    assert.deepEqual(normalizeRoute53(sets, DOMAIN), [])
  })

  it('normalises root name to @', () => {
    const sets = [
      { Name: 'example.com.', Type: 'TXT', TTL: 300, ResourceRecords: [{ Value: '"v=spf1 ~all"' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.name, '@')
  })

  it('normalises subdomain name', () => {
    const sets = [
      { Name: '_dmarc.example.com.', Type: 'TXT', TTL: 300, ResourceRecords: [{ Value: '"v=DMARC1; p=none;"' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.name, '_dmarc')
  })

  it('parses MX priority and strips trailing dot', () => {
    const sets = [
      { Name: 'example.com.', Type: 'MX', TTL: 300, ResourceRecords: [
        { Value: '10 aspmx.l.google.com.' },
        { Value: '20 alt1.aspmx.l.google.com.' },
      ]}
    ]
    const records = normalizeRoute53(sets, DOMAIN)
    assert.equal(records.length, 2)
    assert.equal(records[0].priority, 10)
    assert.equal(records[0].content, 'aspmx.l.google.com')
    assert.equal(records[1].priority, 20)
    assert.equal(records[1].content, 'alt1.aspmx.l.google.com')
  })

  it('unquotes TXT values', () => {
    const sets = [
      { Name: 'example.com.', Type: 'TXT', TTL: 300, ResourceRecords: [{ Value: '"v=spf1 include:spf.example.com ~all"' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.content, 'v=spf1 include:spf.example.com ~all')
  })

  it('leaves TXT values that are not quoted untouched', () => {
    const sets = [
      { Name: 'example.com.', Type: 'TXT', TTL: 300, ResourceRecords: [{ Value: 'v=spf1 ~all' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.content, 'v=spf1 ~all')
  })

  it('strips trailing dot from CNAME value', () => {
    const sets = [
      { Name: 'mail._domainkey.example.com.', Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: 'dkim.example.com.' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.content, 'dkim.example.com')
  })

  it('preserves TTL', () => {
    const sets = [
      { Name: 'example.com.', Type: 'TXT', TTL: 600, ResourceRecords: [{ Value: '"hello"' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.ttl, 600)
  })

  it('omits ttl when undefined', () => {
    const sets = [
      { Name: 'example.com.', Type: 'TXT', ResourceRecords: [{ Value: '"hello"' }] }
    ]
    const [r] = normalizeRoute53(sets, DOMAIN)
    assert.equal(r.ttl, undefined)
  })

  it('expands multiple ResourceRecords into separate DnsRecords', () => {
    const sets = [
      { Name: 'example.com.', Type: 'MX', TTL: 300, ResourceRecords: [
        { Value: '1 aspmx.l.google.com.' },
        { Value: '5 alt1.aspmx.l.google.com.' },
        { Value: '5 alt2.aspmx.l.google.com.' },
      ]}
    ]
    assert.equal(normalizeRoute53(sets, DOMAIN).length, 3)
  })
})

// ---------------------------------------------------------------------------
// Google Cloud DNS
// ---------------------------------------------------------------------------

describe('gcloud normalizeRecords', () => {
  it('filters out non-mail types', () => {
    const sets = [
      { name: 'example.com.', type: 'A',  ttl: 300, rrdatas: ['1.2.3.4'] },
      { name: 'example.com.', type: 'NS', ttl: 300, rrdatas: ['ns1.example.com.'] },
    ]
    assert.deepEqual(normalizeGcloud(sets, DOMAIN), [])
  })

  it('normalises root name to @', () => {
    const sets = [{ name: 'example.com.', type: 'TXT', ttl: 300, rrdatas: ['"v=spf1 ~all"'] }]
    const [r] = normalizeGcloud(sets, DOMAIN)
    assert.equal(r.name, '@')
  })

  it('normalises subdomain name', () => {
    const sets = [{ name: '_dmarc.example.com.', type: 'TXT', ttl: 300, rrdatas: ['"v=DMARC1; p=none;"'] }]
    const [r] = normalizeGcloud(sets, DOMAIN)
    assert.equal(r.name, '_dmarc')
  })

  it('parses MX priority and strips trailing dot', () => {
    const sets = [{ name: 'example.com.', type: 'MX', ttl: 300, rrdatas: ['10 aspmx.l.google.com.', '20 alt1.aspmx.l.google.com.'] }]
    const records = normalizeGcloud(sets, DOMAIN)
    assert.equal(records.length, 2)
    assert.equal(records[0].priority, 10)
    assert.equal(records[0].content, 'aspmx.l.google.com')
    assert.equal(records[1].priority, 20)
  })

  it('unquotes TXT values', () => {
    const sets = [{ name: 'example.com.', type: 'TXT', ttl: 300, rrdatas: ['"v=spf1 include:spf.example.com ~all"'] }]
    const [r] = normalizeGcloud(sets, DOMAIN)
    assert.equal(r.content, 'v=spf1 include:spf.example.com ~all')
  })

  it('strips trailing dot from CNAME value', () => {
    const sets = [{ name: 'mail._domainkey.example.com.', type: 'CNAME', ttl: 300, rrdatas: ['dkim.example.com.'] }]
    const [r] = normalizeGcloud(sets, DOMAIN)
    assert.equal(r.content, 'dkim.example.com')
  })

  it('preserves TTL', () => {
    const sets = [{ name: 'example.com.', type: 'TXT', ttl: 600, rrdatas: ['"hello"'] }]
    const [r] = normalizeGcloud(sets, DOMAIN)
    assert.equal(r.ttl, 600)
  })

  it('expands multiple rrdatas into separate DnsRecords', () => {
    const sets = [{ name: 'example.com.', type: 'MX', ttl: 300, rrdatas: ['1 a.example.com.', '5 b.example.com.', '5 c.example.com.'] }]
    assert.equal(normalizeGcloud(sets, DOMAIN).length, 3)
  })
})

// ---------------------------------------------------------------------------
// Hetzner
// ---------------------------------------------------------------------------

describe('hetzner normalizeRecords', () => {
  it('filters out non-mail types', () => {
    const rrsets = [
      { name: '@', type: 'A',  ttl: 300, records: [{ value: '1.2.3.4' }] },
      { name: '@', type: 'NS', ttl: 300, records: [{ value: 'ns1.example.com.' }] },
    ]
    assert.deepEqual(normalizeHetzner(rrsets), [])
  })

  it('parses MX priority and strips trailing dot', () => {
    const rrsets = [
      { name: '@', type: 'MX', ttl: 300, records: [
        { value: '10 aspmx.l.google.com.' },
        { value: '20 alt1.aspmx.l.google.com.' },
      ]}
    ]
    const records = normalizeHetzner(rrsets)
    assert.equal(records.length, 2)
    assert.equal(records[0].priority, 10)
    assert.equal(records[0].content, 'aspmx.l.google.com')
    assert.equal(records[1].priority, 20)
  })

  it('preserves TXT values as returned by the API', () => {
    const rrsets = [{ name: '@', type: 'TXT', ttl: 300, records: [{ value: '"v=spf1 include:spf.example.com ~all"' }] }]
    const [r] = normalizeHetzner(rrsets)
    assert.equal(r.content, '"v=spf1 include:spf.example.com ~all"')
  })

  it('leaves unquoted TXT values untouched', () => {
    const rrsets = [{ name: '@', type: 'TXT', ttl: 300, records: [{ value: 'v=spf1 ~all' }] }]
    const [r] = normalizeHetzner(rrsets)
    assert.equal(r.content, 'v=spf1 ~all')
  })

  it('strips trailing dot from CNAME value', () => {
    const rrsets = [{ name: 'mail._domainkey', type: 'CNAME', ttl: 300, records: [{ value: 'dkim.example.com.' }] }]
    const [r] = normalizeHetzner(rrsets)
    assert.equal(r.content, 'dkim.example.com')
  })

  it('preserves TTL', () => {
    const rrsets = [{ name: '@', type: 'TXT', ttl: 600, records: [{ value: '"hello"' }] }]
    const [r] = normalizeHetzner(rrsets)
    assert.equal(r.ttl, 600)
  })

  it('omits ttl when null', () => {
    const rrsets = [{ name: '@', type: 'TXT', ttl: null, records: [{ value: '"hello"' }] }]
    const [r] = normalizeHetzner(rrsets)
    assert.equal(r.ttl, undefined)
  })

  it('expands multiple records within an RRSet into separate DnsRecords', () => {
    const rrsets = [
      { name: '@', type: 'MX', ttl: 300, records: [
        { value: '1 a.example.com.' },
        { value: '5 b.example.com.' },
        { value: '5 c.example.com.' },
      ]}
    ]
    assert.equal(normalizeHetzner(rrsets).length, 3)
  })
})

// ---------------------------------------------------------------------------
// Azure DNS
// ---------------------------------------------------------------------------

describe('azure normalizeRecords', () => {
  it('filters out non-mail types (A, NS, SOA)', () => {
    const sets = [
      { name: '@', type: 'Microsoft.Network/dnszones/A',   ttl: 300, txtRecords: [], mxRecords: [] },
      { name: '@', type: 'Microsoft.Network/dnszones/NS',  ttl: 300, txtRecords: [], mxRecords: [] },
      { name: '@', type: 'Microsoft.Network/dnszones/SOA', ttl: 300, txtRecords: [], mxRecords: [] },
    ]
    assert.deepEqual(normalizeAzure(sets), [])
  })

  it('expands txtRecords into separate DnsRecords', () => {
    const sets = [{
      name: '@', type: 'Microsoft.Network/dnszones/TXT', ttl: 300,
      txtRecords: [
        { value: ['v=spf1 include:spf.example.com ~all'] },
        { value: ['some-verification-token'] },
      ]
    }]
    const records = normalizeAzure(sets)
    assert.equal(records.length, 2)
    assert.equal(records[0].type, 'TXT')
    assert.equal(records[0].content, 'v=spf1 include:spf.example.com ~all')
    assert.equal(records[1].content, 'some-verification-token')
  })

  it('expands mxRecords with priority and strips trailing dot', () => {
    const sets = [{
      name: '@', type: 'Microsoft.Network/dnszones/MX', ttl: 300,
      mxRecords: [
        { preference: 10, exchange: 'aspmx.l.google.com.' },
        { preference: 20, exchange: 'alt1.aspmx.l.google.com.' },
      ]
    }]
    const records = normalizeAzure(sets)
    assert.equal(records.length, 2)
    assert.equal(records[0].priority, 10)
    assert.equal(records[0].content, 'aspmx.l.google.com')
    assert.equal(records[1].priority, 20)
    assert.equal(records[1].content, 'alt1.aspmx.l.google.com')
  })

  it('expands cnameRecord and strips trailing dot', () => {
    const sets = [{
      name: 'mail._domainkey', type: 'Microsoft.Network/dnszones/CNAME', ttl: 300,
      cnameRecord: { cname: 'dkim.example.com.' }
    }]
    const [r] = normalizeAzure(sets)
    assert.equal(r.type, 'CNAME')
    assert.equal(r.name, 'mail._domainkey')
    assert.equal(r.content, 'dkim.example.com')
  })

  it('skips CNAME set with no cnameRecord', () => {
    const sets = [{
      name: 'mail._domainkey', type: 'Microsoft.Network/dnszones/CNAME', ttl: 300
    }]
    assert.deepEqual(normalizeAzure(sets), [])
  })

  it('preserves TTL on all record types', () => {
    const sets = [{
      name: '@', type: 'Microsoft.Network/dnszones/TXT', ttl: 600,
      txtRecords: [{ value: ['hello'] }]
    }]
    const [r] = normalizeAzure(sets)
    assert.equal(r.ttl, 600)
  })

  it('handles mixed record types in one call', () => {
    const sets = [
      { name: '@',               type: 'Microsoft.Network/dnszones/MX',   ttl: 300, mxRecords: [{ preference: 10, exchange: 'mx.example.com.' }] },
      { name: '@',               type: 'Microsoft.Network/dnszones/TXT',  ttl: 300, txtRecords: [{ value: ['v=spf1 ~all'] }] },
      { name: 'mail._domainkey', type: 'Microsoft.Network/dnszones/CNAME',ttl: 300, cnameRecord: { cname: 'dkim.example.com.' } },
      { name: '@',               type: 'Microsoft.Network/dnszones/A',    ttl: 300 },
    ]
    const records = normalizeAzure(sets)
    assert.equal(records.length, 3)
    assert.ok(records.some(r => r.type === 'MX'))
    assert.ok(records.some(r => r.type === 'TXT'))
    assert.ok(records.some(r => r.type === 'CNAME'))
  })
})
