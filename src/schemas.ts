import Ajv from 'ajv'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const schemaRoot = new URL('../skills/sameframe/schemas/', import.meta.url)

export async function validateSchema(name: string, value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, schemaRoot), 'utf8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (!validate(value)) throw new Error(`Invalid ${name}: ${JSON.stringify(validate.errors)}`)
}

export function schemaPath(name: string): string {
  return fileURLToPath(new URL(`${name}.schema.json`, schemaRoot))
}
