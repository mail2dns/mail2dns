export function makeFake() {
  let calls = []
  let region = 'us-east-1'
  let verificationToken = 'abc123verifytoken'
  let dkimTokens = ['dkimtoken1', 'dkimtoken2', 'dkimtoken3']
  let error = null

  async function exec(file, args) {
    calls.push([file, ...args])
    if (error) throw error

    if (args.includes('get') && args.includes('region')) {
      return { stdout: region + '\n', stderr: '' }
    }
    if (args.includes('verify-domain-identity')) {
      return { stdout: JSON.stringify({ VerificationToken: verificationToken }), stderr: '' }
    }
    if (args.includes('verify-domain-dkim')) {
      return { stdout: JSON.stringify({ DkimTokens: dkimTokens }), stderr: '' }
    }
    throw new Error(`ses fake: unexpected args: ${args.join(' ')}`)
  }

  return {
    exec,
    get state() {
      return { calls, region, verificationToken, dkimTokens }
    },
    reset() {
      calls = []
      error = null
      region = 'us-east-1'
      verificationToken = 'abc123verifytoken'
      dkimTokens = ['dkimtoken1', 'dkimtoken2', 'dkimtoken3']
    },
    setRegion(r) { region = r },
    setVerificationToken(t) { verificationToken = t },
    setDkimTokens(t) { dkimTokens = t },
    setError(e) { error = e }
  }
}
