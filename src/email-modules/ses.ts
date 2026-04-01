// Amazon SES email module
// DNS records (DKIM CNAMEs, verification TXT) are generated per-domain via the AWS SDK.
// Requires: @aws-sdk/client-ses

import type { DnsRecord, InputDef } from '../types.js'

export const inputs: InputDef[] = [
  { flag: 'awsKey',    name: 'AWS access key ID',     env: 'AWS_ACCESS_KEY_ID'     },
  { flag: 'awsSecret', name: 'AWS secret access key', env: 'AWS_SECRET_ACCESS_KEY' },
  { flag: 'awsRegion', name: 'AWS region',            env: 'AWS_REGION'            }
]

export async function getRecords({ domain, awsKey, awsSecret, awsRegion }: { domain: string; awsKey: string; awsSecret: string; awsRegion: string }): Promise<DnsRecord[]> {
  throw new Error('Amazon SES module not yet implemented')
}
