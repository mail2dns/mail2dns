import { spawn } from 'node:child_process'

export function cli(env, ...args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['--import', 'tsx/esm', 'src/cli.ts', ...args], {
      env: { ...process.env, ...env }
    })
    let stdout = '', stderr = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }))
    proc.on('error', reject)
  })
}
