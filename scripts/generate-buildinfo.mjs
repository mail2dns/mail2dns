import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const epoch = Date.now()

const content = `export default { version: "${version}", date: new Date(${epoch}) }\n`
writeFileSync(join(root, 'src', 'buildInfo.ts'), content)

console.log(`buildInfo: v${version} @ ${new Date(epoch).toISOString()}`)
