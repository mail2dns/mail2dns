import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isConflict, findAndFilterConflicts } from '../src/core.js'

const txt  = (name, content) => ({ type: 'TXT',   name, content })
const mx   = (name, content) => ({ type: 'MX',    name, content })
const cname = (name, content) => ({ type: 'CNAME', name, content })

describe('isConflict', () => {
  describe('MX', () => {
    it('MX conflicts with any MX', () => {
      assert.ok(isConflict(mx('@', 'old-mx.example.com'), mx('@', 'new-mx.example.com')))
    })
    it('MX does not conflict with TXT', () => {
      assert.ok(!isConflict(txt('@', 'v=spf1 ~all'), mx('@', 'mail.example.com')))
    })
  })

  describe('SPF', () => {
    it('SPF TXT conflicts with existing SPF TXT', () => {
      assert.ok(isConflict(txt('@', 'v=spf1 include:old.example.com ~all'), txt('@', 'v=spf1 include:new.example.com ~all')))
    })
    it('SPF TXT does not conflict with non-SPF TXT', () => {
      assert.ok(!isConflict(txt('@', 'some-verification=abc123'), txt('@', 'v=spf1 include:spf.example.com ~all')))
    })
    it('non-SPF TXT does not conflict with SPF TXT', () => {
      assert.ok(!isConflict(txt('@', 'v=spf1 include:spf.example.com ~all'), txt('@', 'some-verification=abc123')))
    })
  })

  describe('verification prefix', () => {
    it('verification TXT conflicts when both contain the prefix', () => {
      assert.ok(isConflict(
        txt('@', 'google-site-verification=old'),
        txt('@', 'google-site-verification=new'),
        'google-site-verification'
      ))
    })
    it('verification TXT does not conflict when prefix is absent', () => {
      assert.ok(!isConflict(
        txt('@', 'some-other-thing=abc'),
        txt('@', 'google-site-verification=new'),
        'google-site-verification'
      ))
    })
    it('no verificationPrefix means no prefix-based conflict', () => {
      assert.ok(!isConflict(
        txt('@', 'google-site-verification=old'),
        txt('@', 'google-site-verification=new')
      ))
    })
  })

  describe('DMARC', () => {
    it('DMARC TXT conflicts with existing DMARC at same name', () => {
      assert.ok(isConflict(txt('_dmarc', 'v=DMARC1; p=none;'), txt('_dmarc', 'v=DMARC1; p=reject;')))
    })
    it('DMARC TXT does not conflict with DMARC at different name', () => {
      assert.ok(!isConflict(txt('_dmarc.sub', 'v=DMARC1; p=none;'), txt('_dmarc', 'v=DMARC1; p=reject;')))
    })
    it('any existing TXT at _dmarc conflicts when desired is DMARC (replace whatever is there)', () => {
      assert.ok(isConflict(txt('_dmarc', 'some-other=value'), txt('_dmarc', 'v=DMARC1; p=reject;')))
    })
    it('DMARC name matching is case-insensitive', () => {
      assert.ok(isConflict(txt('_DMARC', 'v=DMARC1; p=none;'), txt('_dmarc', 'v=DMARC1; p=reject;')))
    })
  })

  describe('DKIM TXT (_domainkey)', () => {
    it('TXT at ._domainkey name conflicts with existing TXT at same name', () => {
      assert.ok(isConflict(txt('google._domainkey', 'v=DKIM1; k=rsa; p=OLD'), txt('google._domainkey', 'v=DKIM1; k=rsa; p=NEW')))
    })
    it('TXT at ._domainkey name conflicts regardless of existing record content', () => {
      assert.ok(isConflict(txt('mx._domainkey', 'anything'), txt('mx._domainkey', 'v=DKIM1; k=rsa; p=NEW')))
    })
    it('TXT at different ._domainkey selector does not conflict', () => {
      assert.ok(!isConflict(txt('mail._domainkey', 'v=DKIM1; k=rsa; p=OLD'), txt('google._domainkey', 'v=DKIM1; k=rsa; p=NEW')))
    })
    it('TXT at ._domainkey name conflicts with prefix-normalized name', () => {
      assert.ok(isConflict(txt('google._domainkey.ms', 'v=DKIM1; k=rsa; p=OLD'), txt('google._domainkey.ms', 'v=DKIM1; k=rsa; p=NEW')))
    })
    it('non-._domainkey TXT at same name does not conflict (e.g. verification at @)', () => {
      assert.ok(!isConflict(txt('@', 'MS=ms12345678'), txt('@', 'v=spf1 include:spf.protection.outlook.com -all')))
    })
  })

  describe('CNAME', () => {
    it('CNAME conflicts with existing CNAME at same name', () => {
      assert.ok(isConflict(cname('email', 'old.mailgun.org'), cname('email', 'new.mailgun.org')))
    })
    it('CNAME conflicts with existing TXT at same name', () => {
      assert.ok(isConflict(txt('email', 'some-value'), cname('email', 'mailgun.org')))
    })
    it('CNAME does not conflict at different name', () => {
      assert.ok(!isConflict(cname('other', 'old.mailgun.org'), cname('email', 'mailgun.org')))
    })
    it('TXT does not conflict with CNAME', () => {
      assert.ok(!isConflict(cname('email', 'mailgun.org'), txt('email', 'some-value')))
    })
  })
})

describe('findAndFilterConflicts', () => {
  const identity = r => r

  it('no existing records — all desired go to toCreate', () => {
    const desired = [mx('@', 'mail.example.com'), txt('@', 'v=spf1 ~all')]
    const { toDelete, conflictRecords, toCreate } = findAndFilterConflicts([], identity, desired)
    assert.deepEqual(toCreate, desired)
    assert.equal(toDelete.length, 0)
    assert.equal(conflictRecords.length, 0)
  })

  it('exact match is a noop — not in toCreate or toDelete', () => {
    const record = mx('@', 'mail.example.com')
    const { toDelete, toCreate } = findAndFilterConflicts([record], identity, [record])
    assert.equal(toCreate.length, 0)
    assert.equal(toDelete.length, 0)
  })

  it('conflicting record goes to toDelete, desired goes to toCreate', () => {
    const existing = mx('@', 'old-mx.example.com')
    const desired  = mx('@', 'new-mx.example.com')
    const { toDelete, conflictRecords, toCreate } = findAndFilterConflicts([existing], identity, [desired])
    assert.deepEqual(toCreate, [desired])
    assert.deepEqual(toDelete, [existing])
    assert.equal(conflictRecords.length, 1)
  })

  it('unrelated existing records are not in toDelete', () => {
    const unrelated = txt('@', 'some-verification=abc123')
    const desired   = mx('@', 'mail.example.com')
    const { toDelete } = findAndFilterConflicts([unrelated], identity, [desired])
    assert.equal(toDelete.length, 0)
  })

  it('multiple MX conflicts all go to toDelete', () => {
    const existing = [mx('@', 'old-mx1.example.com'), mx('@', 'old-mx2.example.com')]
    const desired  = [mx('@', 'new-mx.example.com')]
    const { toDelete, toCreate } = findAndFilterConflicts(existing, identity, desired)
    assert.equal(toDelete.length, 2)
    assert.deepEqual(toCreate, desired)
  })

  it('DKIM TXT conflict detected — old replaced, new created', () => {
    const existing = txt('google._domainkey', 'v=DKIM1; k=rsa; p=OLDKEY')
    const desired  = txt('google._domainkey', 'v=DKIM1; k=rsa; p=NEWKEY')
    const { toDelete, toCreate } = findAndFilterConflicts([existing], identity, [desired])
    assert.deepEqual(toDelete, [existing])
    assert.deepEqual(toCreate, [desired])
  })

  it('DKIM TXT exact match is noop', () => {
    const record = txt('google._domainkey', 'v=DKIM1; k=rsa; p=SAMEKEY')
    const { toDelete, toCreate } = findAndFilterConflicts([record], identity, [record])
    assert.equal(toDelete.length, 0)
    assert.equal(toCreate.length, 0)
  })

  it('MS365 verification TXT at zone root not flagged as conflict with SPF', () => {
    const verifyTxt = txt('ms', 'MS=ms91728533')
    const desired   = [txt('ms', 'v=spf1 include:spf.protection.outlook.com -all')]
    const { toDelete } = findAndFilterConflicts([verifyTxt], identity, desired)
    assert.equal(toDelete.length, 0)
  })

  it('mix: some conflicts, some noops, some new', () => {
    const oldSpf   = txt('@', 'v=spf1 include:old.example.com ~all')
    const oldMx    = mx('@', 'old-mx.example.com')
    const unrelated = txt('@', 'some-verify=abc123')
    const existing = [oldSpf, oldMx, unrelated]

    const newSpf  = txt('@', 'v=spf1 include:new.example.com ~all')
    const sameMx  = mx('@', 'old-mx.example.com')
    const newDkim = txt('google._domainkey', 'v=DKIM1; k=rsa; p=KEY')
    const desired = [newSpf, sameMx, newDkim]

    const { toDelete, toCreate } = findAndFilterConflicts(existing, identity, desired)
    assert.deepEqual(toCreate, [newSpf, newDkim])
    assert.deepEqual(toDelete, [oldSpf]) // oldMx is a noop (sameMx has identical content)
  })
})
