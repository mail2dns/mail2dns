import readline from 'readline'
import type { InputDef } from './types.js'

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

export async function resolveInputs(inputs: InputDef[], argv: Record<string, string | undefined>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const input of inputs) {
    let value = argv[input.flag]
    if (!value && input.env) value = process.env[input.env]
    if (!value) {
      if (input.instructions) log.dim(`\n${input.instructions}`)
      value = await ask(`${input.name}: `)
    }
    if (!value) throw new Error(`${input.name} is required`)
    result[input.flag] = value
  }
  return result
}
