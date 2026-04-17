import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DnsRecord, RawInputDef } from '../types.js'

const execFileAsync = promisify(execFile) as (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

export const inputs: RawInputDef[] = [
  {
    flag: 'awsProfile',
    name: 'AWS profile to use',
    env: 'AWS_PROFILE',
    example: 'my-profile',
    optional: true,
    value: 'profile'
  }
]

type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

function makeAws(profileArgs: string[], exec: ExecFn) {
  return async function aws<T>(args: string[]): Promise<T> {
    const { stdout } = await exec('aws', [...profileArgs, ...args, '--output', 'json'])
      .catch((e: { stderr?: string; message: string }) => {
        throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}\nIs the AWS CLI installed and configured?`)
      })
    return JSON.parse(stdout) as T
  }
}

async function getRegion(profileArgs: string[], exec: ExecFn): Promise<string> {
  const { stdout } = await exec('aws', [...profileArgs, 'configure', 'get', 'region'])
    .catch((e: { stderr?: string; message: string }) => {
      throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}\nIs the AWS CLI installed and configured?`)
    })
  const region = stdout.trim()
  if (!region) throw new Error('Could not determine AWS region from profile. Ensure your AWS CLI profile has a default region configured.')
  return region
}

export async function buildRecordsFromExec(domain: string, profileArgs: string[], exec: ExecFn): Promise<DnsRecord[]> {
  const aws = makeAws(profileArgs, exec)
  const region = await getRegion(profileArgs, exec)

  const [identity, dkim] = await Promise.all([
    aws<{ VerificationToken: string }>(['ses', 'verify-domain-identity', '--domain', domain]),
    aws<{ DkimTokens: string[]      }>(['ses', 'verify-domain-dkim',     '--domain', domain])
  ])

  const { VerificationToken } = identity
  const { DkimTokens } = dkim
  if (!VerificationToken) throw new Error('SES did not return a verification token')
  if (!DkimTokens || DkimTokens.length < 3) throw new Error('SES did not return 3 DKIM tokens')

  return [
    { type: 'TXT',   name: '_amazonses',                  content: VerificationToken,                                ttl: 1                           },
    { type: 'MX',    name: '@',                            content: `inbound-smtp.${region}.amazonaws.com`,          ttl: 1, priority: 10              },
    { type: 'MX',    name: '@',                            content: `feedback-smtp.${region}.amazonses.com`,          ttl: 1, priority: 20, required: true },
    { type: 'TXT',   name: '@',                            content: 'v=spf1 include:amazonses.com ~all',              ttl: 1                           },
    { type: 'TXT',   name: '_dmarc',                       content: 'v=DMARC1; p=none;',                        ttl: 1            },
    { type: 'CNAME', name: `${DkimTokens[0]}._domainkey`, content: `${DkimTokens[0]}.dkim.amazonses.com`,       ttl: 1            },
    { type: 'CNAME', name: `${DkimTokens[1]}._domainkey`, content: `${DkimTokens[1]}.dkim.amazonses.com`,       ttl: 1            },
    { type: 'CNAME', name: `${DkimTokens[2]}._domainkey`, content: `${DkimTokens[2]}.dkim.amazonses.com`,       ttl: 1            },
  ]
}

export async function getRecords({ domain, awsProfile }: { domain: string } & Record<string, string>): Promise<DnsRecord[]> {
  const profileArgs = awsProfile ? ['--profile', awsProfile] : []
  return buildRecordsFromExec(domain, profileArgs, execFileAsync)
}
