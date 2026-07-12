import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export function targetPaths(root: string, target: 'reference' | 'candidate') {
  const directory = join(root, target)
  return {
    directory,
    page: join(directory, 'page.json'),
    tree: join(directory, 'tree.json'),
    screenshot: join(directory, 'screenshot.png'),
  }
}

export function comparisonPaths(root: string) {
  const directory = join(root, 'comparison')
  return {
    directory,
    result: join(directory, 'result.json'),
    matches: join(directory, 'matches.json'),
    findings: join(directory, 'findings.json'),
    diff: join(directory, 'screenshot-diff.png'),
  }
}
