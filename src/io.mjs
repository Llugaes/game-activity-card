import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises'
import path from 'node:path'
// All mutable files belong to the consumer, never to the installed package.
export const root = path.resolve(process.env.PLAYER_LOG_ROOT || process.cwd())
const aliases = name => ({ 'activity.config.json': process.env.PLAYER_LOG_CONFIG_PATH,
  'data/activity.json': process.env.PLAYER_LOG_DATA_PATH, 'state/psn-session.enc.json': process.env.PLAYER_LOG_STATE_PATH }[name])
  || (name.startsWith('assets/') && process.env.PLAYER_LOG_OUTPUT_DIR ? path.join(process.env.PLAYER_LOG_OUTPUT_DIR, name.slice(7)) : name)
const inside = (parent, target) => { const relative = path.relative(parent, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }
export async function resolveFile(name) {
  const target = path.resolve(root, aliases(name))
  if (!inside(root, target) || target === root) throw new Error('path_outside_workspace')
  const realRoot = await realpath(root)
  let existing = target
  for (;;) {
    try { if (!inside(realRoot, await realpath(existing))) throw new Error('path_outside_workspace'); break }
    catch (error) { if (error.code !== 'ENOENT') throw error; existing = path.dirname(existing) }
  }
  return target
}
export const readJson = async name => JSON.parse(await readFile(await resolveFile(name), 'utf8'))
export async function write(name, content) {
  const target = await resolveFile(name)
  await mkdir(path.dirname(target), { recursive: true })
  await resolveFile(path.relative(root, `${target}.tmp`))
  await writeFile(`${target}.tmp`, content)
  await rename(`${target}.tmp`, target)
}
export const writeJson = (name, data) => write(name, JSON.stringify(data, null, 2) + '\n')
