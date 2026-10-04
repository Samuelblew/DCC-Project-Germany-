import { readFileSync } from 'node:fs'

const text = readFileSync(process.argv[2], 'utf8')
const index = text.indexOf('["name"] = "BSAM-HAWK-1"')
console.log(text.slice(Math.max(0, index - 1800), index + 200))
