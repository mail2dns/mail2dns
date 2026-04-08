import readline from 'readline'
import type { InputDef, OptionDef, DnsRecord } from './types.js'

export const COMMANDS: Record<string, { description: string; options: OptionDef[] }> = {
  setup: {
    description: 'Create DNS records for an email provider',
    options: [
      { flag: 'noMx', description: 'skip MX records (for outbound-only use)', default: false },
      { flag: 'yes', short: 'y', description: 'skip confirmation prompt (error if any required inputs are missing)', default: false },
    ],
  },
  verify:  { description: 'Check that expected DNS records are in place', options: [] },
  list:    { description: 'Show existing DNS records for a domain', options: [] },
  preview: { description: 'Show DNS records that would be created without applying them', options: [] },
}

const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
}

export const log = {
  success: (msg: string) => console.log(c.green(msg)),
  error:   (msg: string) => console.error(c.red(msg)),
  warn:    (msg: string) => console.log(c.yellow(msg)),
  info:    (msg: string) => console.log(msg),
  dim:     (msg: string) => console.log(c.dim(msg)),
}

export function camelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)
}

export function ucfirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(question)
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
}

export function formatDnsRecord(r: DnsRecord): string {
  const priority = r.priority !== undefined ? ` (priority ${r.priority})` : ''
  return `  [${r.type.padEnd(5)}] ${r.name} → ${r.content}${priority}`
}

export async function resolveInputs(inputs: InputDef[], argv: Record<string, string | undefined>, nonInteractive = false): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const input of inputs) {
    let value = argv[input.flag]
    if (!value && input.env) value = process.env[input.env]
    if (!value) {
      if (input.optional) continue
      if (nonInteractive) throw new Error(`${input.name} is required${input.env ? ` (or set ${input.env})` : ''}`)
      if (input.instructions) log.dim(`\n${input.instructions}`)
      value = await ask(`${input.name}: `)
    }
    if (!value) throw new Error(`${input.name} is required`)
    result[input.flag] = value
  }
  return result
}

