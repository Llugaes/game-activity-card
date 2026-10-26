import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import sharp from 'sharp'
const cli = fileURLToPath(new URL('../bin/player-log.mjs', import.meta.url))
const cleanEnv = workspace => ({ ...process.env, GITHUB_WORKSPACE: workspace, STEAM_API_KEY: '', PSN_NPSSO: '', NINTENDO_SESSION_TOKEN: '',
  PLAYER_LOG_ROOT: '', PLAYER_LOG_CONFIG_PATH: '', PLAYER_LOG_DATA_PATH: '', PLAYER_LOG_OUTPUT_DIR: '', PLAYER_LOG_STATE_PATH: '', SYNC_PLATFORMS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' })
test('独立消费者：首次sync、离线render、可解码图片与自定义路径', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-card-consumer-'))
  try {
    const env = cleanEnv(workspace)
    execFileSync(process.execPath, [cli, 'sync', '--platforms', 'steam', '--data', 'history/plays.json', '--output', 'images'], { cwd: workspace, env })
    assert.equal(JSON.parse(await readFile(path.join(workspace, 'history/plays.json'), 'utf8')).schemaVersion, 2)
    for (const file of ['player-log.webp', 'player-log-mobile.webp']) {
      const image = await sharp(await readFile(path.join(workspace, 'images', file))).metadata()
      assert.equal(image.format, 'webp')
    }
    assert.ok((await readFile(path.join(workspace, 'docs/ACTIVITY.md'), 'utf8')).includes('尚未连接'))
    execFileSync(process.execPath, [cli, 'render', '--data', 'history/plays.json', '--output', 'images'], { cwd: workspace, env: { ...env, STEAM_API_KEY: 'unused-secret', PSN_NPSSO: 'unused-secret' } })
  } finally { await rm(workspace, { recursive: true }) }
})
test('collect只写数据，缺失凭据可跳过，不加载图片流水线', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-card-collect-'))
  try {
    execFileSync(process.execPath, [cli, 'collect'], { cwd: workspace, env: cleanEnv(workspace) })
    const data = JSON.parse(await readFile(path.join(workspace, 'data/activity.json'), 'utf8'))
    assert.equal(data.platforms.steam.reason, 'missing_secret')
    await assert.rejects(readFile(path.join(workspace, 'assets/player-log.webp')), { code: 'ENOENT' })
  } finally { await rm(workspace, { recursive: true }) }
})
test('拒绝相对路径逃逸、工作区外root、控制字符和损坏数据', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-card-path-'))
  try {
    const env = cleanEnv(workspace)
    for (const args of [['collect', '--data', '../escaped.json'], ['render', '--root', path.dirname(workspace)], ['collect', '--output', 'images\nfailures=0']]) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: workspace, env, encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /path_outside_workspace|invalid_path/)
    }
    await mkdir(path.join(workspace, 'data'))
    await writeFile(path.join(workspace, 'data/activity.json'), '{broken-private-value')
    const result = spawnSync(process.execPath, [cli, 'render'], { cwd: workspace, env, encoding: 'utf8' })
    assert.equal(result.status, 1); assert.ok(!result.stderr.includes('broken-private-value'))
  } finally { await rm(workspace, { recursive: true }) }
})
test('拒绝已有符号链接把输出写到workspace外', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-card-link-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'game-card-outside-'))
  try {
    try { await symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) { if (error.code === 'EPERM') return t.skip('symbolic links unavailable'); throw error }
    const result = spawnSync(process.execPath, [cli, 'collect', '--data', 'escape/data.json'], { cwd: workspace, env: cleanEnv(workspace), encoding: 'utf8' })
    assert.equal(result.status, 1); assert.match(result.stderr, /path_outside_workspace/)
    await assert.rejects(readFile(path.join(outside, 'data.json')), { code: 'ENOENT' })
  } finally { await rm(workspace, { recursive: true }); await rm(outside, { recursive: true }) }
})
