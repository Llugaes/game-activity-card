import { collectSteam, collectPsn } from './collectors.mjs'
import { collectNintendo } from './nintendo.mjs'
import { acceptSnapshot, failedSnapshot, emptyData } from './model.mjs'
import { platforms } from './window.mjs'

export async function collectActivity({ data = emptyData(), config, titles = {}, env = process.env,
  at = new Date().toISOString(), selected = platforms, collectors = {}, readVault, writeVault }) {
  if (!selected.length || selected.some(platform => !platforms.includes(platform))) throw new Error('invalid_platforms')
  data.schemaVersion = 2
  data.intervals ||= []
  const reports = []; let failures = 0
  for (const [platform, collector] of Object.entries({ steam: collectSteam, psn: collectPsn, switch: collectNintendo, ...collectors })) {
    if (!selected.includes(platform)) continue
    const account = platform === 'steam' ? config.steamId : platform === 'psn' ? config.psnOnlineId : undefined
    if (platform !== 'switch' && data.platforms[platform]?.account && data.platforms[platform].account.toLowerCase() !== String(account || '').toLowerCase()) data.platforms[platform] = { status: 'pending', games: [] }
    try {
      if ((platform === 'steam' && !config.steamId) || (platform === 'psn' && !config.psnOnlineId)) {
        if (env[platform === 'steam' ? 'STEAM_API_KEY' : 'PSN_NPSSO']) throw Object.assign(new Error(), { code: 'invalid_data' })
        throw Object.assign(new Error(), { code: 'missing_secret' })
      }
      const current = await collector({ env, config, titles, at, previous: data.platforms[platform], readVault, writeVault })
      const { snapshot, interval } = acceptSnapshot(data.platforms[platform], current, platform)
      data.platforms[platform] = snapshot
      if (interval) data.intervals.push(interval)
      reports.push(`${platform}: 已同步 ${snapshot.games.length} 条游戏记录`)
    } catch (error) {
      const snapshot = failedSnapshot(data.platforms[platform], error.code)
      data.platforms[platform] = snapshot
      const stage = ['psn_signin', 'psn_token', 'psn_profile', 'psn_games', 'psn_trophies', 'psn_refresh'].includes(error.stage) ? ` (${error.stage})` : ''
      reports.push(`${platform}: ${snapshot.reason}${stage}；保留最后有效记录`)
      if (snapshot.reason !== 'missing_secret') failures++
    }
  }
  data.intervals = (data.intervals || []).filter(interval => Date.parse(interval.to) >= Date.parse(at) - 366 * 86400000)
  return { data, reports, failures }
}
