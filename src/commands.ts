import type { OptionDef } from './types.js'

export const COMMANDS: Record<string, { description: string; options: OptionDef[] }> = {
  setup: {
    description: 'Create DNS records for an email provider',
    options: [
      { flag: 'noMx', short: 'o', description: 'Skip MX records (set up DNS for outbound email only)', default: false },
      { flag: 'yes', short: 'y', description: 'Skip confirmation prompts (the command will error if any required inputs are missing)', default: false },
      { flag: 'allowInsecureFlags', description: 'Allow secrets to be passed via command-line flags (not recommended)', default: false },
      { flag: 'dryRun', short: 'd', description: 'Show records that would be created without applying them', default: false },
    ],
  },
  verify: {
    description: 'Check that expected DNS records are in place',
    options: [
      { flag: 'noMx', short: 'o', description: 'Skip MX records (verify DNS for outbound email only)', default: false },
    ],
  },
  list: {
    description: 'Show existing DNS records for a domain',
    options: [
      { flag: 'allowInsecureFlags', description: 'Allow secrets to be passed via command-line flags (not recommended)', default: false },
    ],
  },
}
