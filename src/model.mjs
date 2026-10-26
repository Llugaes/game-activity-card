export class SyncError extends Error {
  constructor(code) { super(code); this.code = code }
}

export function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function iso(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}

export function durationMinutes(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value || '')
  if (!match || !match.slice(1).some(v => v !== undefined)) return null
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match
  return Math.floor(+days * 1440 + +hours * 60 + +minutes + +seconds / 60)
}

export function steamGames(response, config, titles = {}) {
  if (!response || !Number.isInteger(response.total_count) || response.total_count < 0
    || (response.total_count > 0 && !Array.isArray(response.games))) throw new SyncError('unavailable')
  const games = response.games || []
  if (games.length !== response.total_count) throw new SyncError('incomplete')
  return games.filter(g => !Object.hasOwn(config.excludedSteamApps || {}, String(g.appid))).map(g => {
    if (!Number.isInteger(g.appid) || !g.name || number(g.playtime_forever) === null
      || number(g.playtime_2weeks) === null) throw new SyncError('invalid_data')
    return { id: String(g.appid), title: titles[g.appid] || g.name,
      totalMinutes: g.playtime_forever, recentMinutes: g.playtime_2weeks,
      lastPlayedAt: g.rtime_last_played ? iso(new Date(g.rtime_last_played * 1000).toISOString()) : null }
  }).sort((a, b) => b.recentMinutes - a.recentMinutes || a.id.localeCompare(b.id))
}

export function psnGames(titles) {
  return titles.map(g => {
    if (!g.titleId || !(g.localizedName || g.name)) throw new SyncError('invalid_data')
    return { id: String(g.titleId), title: g.localizedName || g.name,
      totalMinutes: durationMinutes(g.playDuration), recentMinutes: null,
      lastPlayedAt: iso(g.lastPlayedDateTime), imageUrl: typeof (g.localizedImageUrl || g.imageUrl) === 'string' ? (g.localizedImageUrl || g.imageUrl) : null }
  }).sort((a, b) => (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || ''))
}

export function acceptSnapshot(previous = {}, current, platform) {
  const sameScope = previous.source === current.source && previous.account === current.account
  if (sameScope && previous.collectedAt && current.collectedAt <= previous.collectedAt) return { snapshot: previous, interval: null }
  const comparable = previous.source === current.source && previous.account === current.account
    && previous.collectedAt && current.collectedAt > previous.collectedAt
  let interval = null
  // 只对同一来源、同一账号的两次累计值求差；初次导入不伪造历史。
  if (comparable && platform !== 'switch') {
    const before = new Map((previous.games || []).map(g => [g.id, g]))
    let minutes = 0, compared = 0, unknown = 0
    for (const game of current.games) {
      const old = before.get(game.id)
      if (number(old?.totalMinutes) === null || number(game.totalMinutes) === null
        || game.totalMinutes < old.totalMinutes) { unknown++; continue }
      minutes += game.totalMinutes - old.totalMinutes
      compared++
    }
    if (compared) interval = { platform, from: previous.collectedAt, to: current.collectedAt,
      minutes, comparedGames: compared, newOrResetGames: unknown }
  }
  if (platform === 'psn') {
    const before = new Map((previous.games || []).map(g => [g.id, g]))
    const observedSince = sameScope ? { ...previous.observedSince } : {}
    const observations = sameScope ? [...(previous.observations || [])] : []
    const games = [], unknownGames = []
    for (const game of current.games) {
      const old = before.get(game.id)
      if (!comparable || number(old?.totalMinutes) === null || number(game.totalMinutes) === null || game.totalMinutes < old.totalMinutes) {
        observedSince[game.id] = current.collectedAt
        unknownGames.push(game.id)
      } else {
        observedSince[game.id] ||= previous.collectedAt
        games.push({ id: game.id, minutes: game.totalMinutes - old.totalMinutes })
      }
    }
    if (comparable) observations.push({ from: previous.collectedAt, to: current.collectedAt, games, unknownGames })
    current = { ...current, observedSince, observations: observations.filter(i => Date.parse(i.to) >= Date.parse(current.collectedAt) - 366 * 86400000) }
  }
  return { snapshot: current, interval }
}

export function failedSnapshot(previous, code) {
  const reason = ['missing_secret', 'auth_required', 'account_mismatch', 'unavailable', 'incomplete', 'invalid_data'].includes(code) ? code : 'unavailable'
  return { ...(previous || { games: [] }), status: previous?.collectedAt ? (previous.source === 'steam-local' ? 'local' : 'stale') : 'pending', reason }
}

export function emptyData() {
  return { schemaVersion: 2, platforms: {
    steam: { status: 'pending', reason: 'missing_secret', games: [] },
    psn: { status: 'pending', reason: 'missing_secret', games: [] },
    switch: { status: 'pending', reason: 'missing_secret', games: [] }
  }, intervals: [] }
}
