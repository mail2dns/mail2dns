import { camelToKebab } from './utils.js'
import type { ArgumentDef, OptionDef } from './types.js'

function opt(o: Omit<OptionDef, 'cliFlag'>): OptionDef {
  return { ...o, cliFlag: `--${camelToKebab(o.flag)}` }
}

export const COMMANDS: Record<string, { description: string; args: ArgumentDef[]; options: OptionDef[] }> = {
  setup: {
    description: 'Create DNS records for an email provider',
    args: [
      { name: 'domain' },
      { name: 'email-provider' },
      { name: 'dns-provider' },
    ],
    options: [
      opt({ flag: 'noMx', short: 'o', description: 'Skip MX records (set up DNS for outbound email only)', default: false }),
      opt({ flag: 'yes', short: 'y', description: 'Skip confirmation prompts (the command will error if any required inputs are missing)', default: false }),
      opt({ flag: 'allowInsecureFlags', description: 'Allow secrets to be passed via command-line flags (not recommended)', default: false }),
      opt({ flag: 'dryRun', short: 'd', description: 'Show records that would be created without applying them', default: false }),
      opt({ flag: 'zone', short: 'z', description: 'DNS zone that contains the domain (overrides auto-detection)', default: '', value: 'domain' }),
      opt({ flag: 'dmarcPolicy', short: 'p', description: 'DMARC policy to use in the _dmarc TXT record (none, quarantine, reject)', default: 'none', value: 'policy' }),
    ],
  },
  verify: {
    description: 'Check that expected DNS records for an email provider are present via public DNS lookup',
    args: [
      { name: 'domain' },
      { name: 'email-provider' },
    ],
    options: [
      opt({ flag: 'noMx', short: 'o', description: 'Skip MX records (verify DNS for outbound email only)', default: false }),
      opt({ flag: 'dmarcPolicy', short: 'p', description: 'Expected DMARC policy in the _dmarc TXT record (none, quarantine, reject)', default: 'none', value: 'policy' }),
    ],
  },
  list: {
    description: 'Show existing DNS records for a domain via the DNS provider API',
    args: [
      { name: 'domain' },
      { name: 'dns-provider' },
    ],
    options: [
      opt({ flag: 'allowInsecureFlags', description: 'Allow secrets to be passed via command-line flags (not recommended)', default: false }),
      opt({ flag: 'zone', short: 'z', description: 'DNS zone that contains the domain (overrides auto-detection)', default: '', value: 'domain' }),
    ],
  },
}
