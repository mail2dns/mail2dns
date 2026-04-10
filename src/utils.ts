import readline from 'readline'
import type { InputDef, DnsRecord } from './types.js'

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

export function askSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    let muted = false
    const origWrite = (rl as any)._writeToOutput.bind(rl)
    ;(rl as any)._writeToOutput = (s: string) => { if (!muted) origWrite(s) }
    rl.question(question, (answer: string) => {
      process.stderr.write('\n')
      rl.close()
      resolve(answer.trim())
    })
    muted = true
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

export function assertNoInsecureFlags(inputs: InputDef[], argv: Record<string, string | undefined>, docsUrl?: string): void {
  for (const input of inputs) {
    if (argv[input.flag] && input.secret) {
      const envHint = input.env ? ` Use the ${input.env} environment variable instead, or provide it interactively.` : ''
      const urlHint = docsUrl ? `\nFor more information, see ${docsUrl}` : ''
      throw new Error(
        `${input.name} should not be passed via command-line flags as it will be visible in your shell history and process list.${envHint}\n` +
        `To override this, pass --allow-insecure-flags or set M2D_ALLOW_INSECURE_FLAGS=true.${urlHint}`
      )
    }
  }
}

export function findContainingZone(domain: string, zones: string[]): string | undefined {
  return zones
    .filter(z => domain === z || domain.endsWith(`.${z}`))
    .sort((a, b) => b.length - a.length)[0]
}

export async function resolveInputs(inputs: InputDef[], argv: Record<string, string | undefined>, nonInteractive = false): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const input of inputs) {
    let value = argv[input.flag]
    if (!value && input.env) value = process.env[input.env]
    if (!value && input.default) value = input.default
    if (!value) {
      if (input.optional) continue
      if (nonInteractive) throw new Error(`${input.name} is required${input.env ? ` (or set ${input.env})` : ''}`)
      if (input.instructions) log.dim(`\n${input.instructions}`)
      value = input.secret ? await askSecret(`${input.name}: `) : await ask(`${input.name}: `)
    }
    if (!value) throw new Error(`${input.name} is required`)
    result[input.flag] = value
  }
  return result
}

