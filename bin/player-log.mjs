#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFile, appendFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string' }, config: { type: 'string' }, data: { type: 'string' }, output: { type: 'string' }, state: { type: 'string' },
    platforms: { type: 'string' }, 'as-of': { type: 'string' }, repo: { type: 'string' }, 'steam-root': { type: 'string' }, help: { type: 'boolean' }
  } })
  const mode = positionals[0] || 'sync'
  if (values.help) { console.log('game-activity-card <sync|collect|render|link-readme|connect-nintendo|import-steam> [--root DIR] [--config FILE] [--data FILE] [--output DIR] [--state FILE] [--platforms steam,psn,switch] [--repo OWNER/REPO]'); return }
  if (!['sync', 'all', 'collect', 'render', 'link-readme', 'connect-nintendo', 'import-steam'].includes(mode)) throw new Error('invalid_mode')
  for (const [arg, name] of Object.entries({ root: 'ROOT', config: 'CONFIG_PATH', data: 'DATA_PATH', output: 'OUTPUT_DIR', state: 'STATE_PATH' })) {
    const value = values[arg] || process.env[`PLAYER_LOG_${name}`]
    if (value && /[\x00-\x1f]/.test(value)) throw new Error('invalid_path')
    if (values[arg]) process.env[`PLAYER_LOG_${name}`] = values[arg]
  }
  if (process.env.GITHUB_WORKSPACE) {
    const workspace = await realpath(process.env.GITHUB_WORKSPACE), target = await realpath(path.resolve(process.env.PLAYER_LOG_ROOT || process.cwd()))
    const relative = path.relative(workspace, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('path_outside_workspace')
  }
  const { root, readJson, writeJson, write, resolveFile } = await import('../src/io.mjs')
  const optionalJson = async (file, fallback) => { try { return await readJson(file) } catch (error) { if (error.code !== 'ENOENT') throw error; return fallback } }
  const repository = values.repo || process.env.GITHUB_REPOSITORY
  if (mode === 'connect-nintendo') {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('invalid_repository')
    const { startConnection } = await import('../src/connect-nintendo.mjs')
    startConnection(4319, repository); return
  }
  if (mode === 'link-readme') {
    const { linkCard } = await import('../src/link-card.mjs')
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const outputDir = process.env.PLAYER_LOG_OUTPUT_DIR || 'assets'
    for (const suffix of ['', '-mobile']) execFileSync('git', ['cat-file', '-e', `${revision}:${outputDir}/player-log${suffix}.webp`], { cwd: root, stdio: 'pipe' })
    await write('README.md', linkCard(await readFile(await resolveFile('README.md'), 'utf8'), revision, { repository, outputDir })); return
  }
  const { emptyData, steamGames } = await import('../src/model.mjs')
  const { validateConfig } = await import('../src/config.mjs')
  const config = validateConfig(await optionalJson('activity.config.json', {}))
  const at = values['as-of'] || new Date().toISOString()
  if (!Number.isFinite(Date.parse(at))) throw new Error('invalid_as_of')
  let data = await optionalJson('data/activity.json', emptyData())
  if (![1, 2].includes(data.schemaVersion) || !data.platforms || !Array.isArray(data.intervals)) throw new Error('invalid_data')
  let failures = 0, reports = []
  if (mode === 'import-steam') {
    if (!config.steamId || !values['steam-root']) throw new Error('steam_root_required')
    if (data.platforms.steam?.source === 'steam-api') throw new Error('cloud_data_already_connected')
    const { localRecentGames } = await import('../src/vdf.mjs')
    const { json } = await import('../src/collectors.mjs')
    const account = BigInt(config.steamId) - 76561197960265728n
    if (account < 1n || account > 4294967295n) throw new Error('invalid_steam_id')
    const file = path.join(values['steam-root'], 'userdata', String(account), 'config/localconfig.vdf')
    const collectedAt = (await stat(file)).mtime.toISOString()
    const games = localRecentGames(await readFile(file, 'utf8'), collectedAt, config.excludedSteamApps)
    const titles = await optionalJson('data/steam-titles.json', {})
    for (const game of games) if (!titles[game.appid]) {
      const app = (await json(`https://store.steampowered.com/api/appdetails?appids=${game.appid}&l=schinese`))[game.appid]?.data
      if (!app?.name || app.type !== 'game') throw new Error('app_type_unknown')
      titles[game.appid] = app.name
    }
    data.platforms.steam = { status: 'local', source: 'steam-local', account: config.steamId, collectedAt, games: steamGames({ total_count: games.length, games }, config, titles) }
    await writeJson('data/steam-titles.json', titles)
    await writeJson('data/activity.json', data)
  } else if (['sync', 'all', 'collect'].includes(mode)) {
    const { collectActivity } = await import('../src/collect.mjs')
    const selected = (values.platforms || process.env.SYNC_PLATFORMS || 'steam,psn,switch').split(',')
    const result = await collectActivity({ data, config, titles: await optionalJson('data/steam-titles.json', {}), at, selected })
    ;({ data, failures, reports } = result)
    await writeJson('data/activity.json', data)
    console.log(reports.join('\n'))
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## 游戏记录同步\n\n${reports.map(report => '- ' + report).join('\n')}\n`, 'utf8')
  }
  if (mode !== 'collect') {
    const { renderFiles } = await import('../src/render.mjs')
    const view = await renderFiles(data, { ...config, asOf: at, downloadCovers: ['sync', 'all'].includes(mode) })
    console.log(`已生成桌面、手机版卡片与详情：${view.rows.length} 款近期游戏`)
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `data-path=${process.env.PLAYER_LOG_DATA_PATH || 'data/activity.json'}\noutput-dir=${process.env.PLAYER_LOG_OUTPUT_DIR || 'assets'}\nfailures=${failures}\n`, 'utf8')
  if (failures) process.exitCode = 1
}
main().catch(error => {
  const safe = new Set(['invalid_mode', 'invalid_path', 'invalid_repository', 'invalid_config', 'invalid_data', 'invalid_platforms', 'invalid_as_of', 'invalid_steam_id', 'invalid_psn_id', 'invalid_name', 'path_outside_workspace', 'readme_card_links_not_found', 'invalid_revision', 'invalid_output_dir', 'steam_root_required', 'cloud_data_already_connected', 'app_type_unknown'])
  console.error(`game-activity-card: ${safe.has(error.message) ? error.message : 'operation_failed'}。请检查命令、配置与工作区路径；凭据和响应正文不会输出。`)
  process.exitCode = 1
})
