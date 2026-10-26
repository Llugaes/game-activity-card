import { SyncError, steamGames, psnGames, number } from './model.mjs'
import { psnAuthorization } from './psn-auth.mjs'
import { psnRequest } from './psn-request.mjs'

export async function json(url, fetcher = fetch) {
  // 不记录包含 key 的地址的 URL、响应正文或底层异常。
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(25000), redirect: 'error' })
    if (!response.ok) throw new Error()
    return await response.json()
  } catch { throw new SyncError('unavailable') }
}

export async function collectSteam({ env, config, titles, at, fetcher }) {
  if (!env.STEAM_API_KEY) throw new SyncError('missing_secret')
  const url = new URL('https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/')
  url.search = new URLSearchParams({ key: env.STEAM_API_KEY, steamid: config.steamId, count: '0' }).toString()
  const response = await json(url, fetcher)
  return { status: 'synced', source: 'steam-api', account: config.steamId, collectedAt: at,
    games: steamGames(response.response, config, titles) }
}

export async function collectPsn({ env, config, at, api, readVault, writeVault }) {
  if (!env.PSN_NPSSO) throw new SyncError('missing_secret')
  api ||= await import('psn-api')
  const auth = await psnAuthorization({ env, config, api, at, readVault, writeVault })
  const games = [], seen = new Set()
  let offset = 0
  for (let page = 0; page < 100; page++) {
    const result = await psnRequest('psn_games', () => api.getUserPlayedGames(auth, auth.accountId, { limit: 100, offset }))
    if (!Array.isArray(result.titles)) throw new SyncError('invalid_data')
    games.push(...result.titles)
    if (result.nextOffset === undefined || result.nextOffset === null) {
      if (number(result.totalItemCount) === null || games.length !== result.totalItemCount) throw new SyncError('incomplete')
      const trophies = auth.trophies
      const earned = trophies.earnedTrophies || {}
      return { status: 'synced', source: 'psn-api', account: config.psnOnlineId, collectedAt: at,
        games: psnGames(games), trophies: { platinum: number(earned.platinum), gold: number(earned.gold),
          silver: number(earned.silver), bronze: number(earned.bronze) } }
    }
    if (!Number.isInteger(result.nextOffset) || result.nextOffset <= offset || seen.has(result.nextOffset)) throw new SyncError('incomplete')
    seen.add(offset)
    offset = result.nextOffset
  }
  throw new SyncError('incomplete')
}
