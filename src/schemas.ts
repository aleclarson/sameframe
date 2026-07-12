import Ajv2020 from 'ajv/dist/2020.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const schemaRoot = new URL('../skills/sameframe/schemas/', import.meta.url)

export async function validateSchema(name: string, value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, schemaRoot), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true })
  if (name === 'comparison-batch')
    ajv.addSchema(
      JSON.parse(await readFile(new URL('comparison-result.schema.json', schemaRoot), 'utf8')),
      'comparison-result.schema.json',
    )
  const validate = ajv.compile(schema)
  if (!validate(value)) throw new Error(`Invalid ${name}: ${JSON.stringify(validate.errors)}`)
}

export function schemaPath(name: string): string {
  return fileURLToPath(new URL(`${name}.schema.json`, schemaRoot))
}
