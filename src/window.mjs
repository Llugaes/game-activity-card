import { number } from './model.mjs'

export const platforms = ['steam', 'psn', 'switch']
export const platformNames = { steam: 'Steam', psn: 'PlayStation', switch: 'Switch' }
const dayMs = 86400000
export function dateLabel(value, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

// A projection never mutates stored provider data. Each row keeps its evidence method.
export function activityWindow(data, { asOf = new Date().toISOString(), timeZone = 'UTC' } = {}) {
  const end = Date.parse(asOf)
  if (!Number.isFinite(end)) throw new Error('invalid_as_of')
  const start = end - 14 * dayMs
  const today = dateLabel(asOf, timeZone)
  const firstDay = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * dayMs).toISOString().slice(0, 10)
  const rows = [], summaries = {}
  for (const platform of platforms) {
    const snapshot = data.platforms?.[platform] || { status: 'pending', games: [] }
    const collected = Date.parse(snapshot.collectedAt)
    const available = Number.isFinite(collected) && collected <= end
    const stale = snapshot.status !== 'synced' || !available || end - collected > dayMs
    const summary = { platform, status: snapshot.status, reason: snapshot.reason, collectedAt: snapshot.collectedAt,
      stale, partial: !available, gaps: [], method: platform === 'steam' ? 'native' : platform === 'psn' ? 'observed' : 'daily', minutes: available ? 0 : null }
    summaries[platform] = summary
    if (!available) { summary.gaps.push('no_valid_snapshot'); continue }
    if (stale) summary.gaps.push('collection_stale')
    if (platform === 'steam' && stale) { summary.minutes = null; summary.partial = true; summary.gaps.push('frozen_native_window'); continue }
    const totals = new Map(), incomplete = new Set()
    if (platform === 'steam') {
      summary.from = new Date(collected - 14 * dayMs).toISOString()
      summary.to = snapshot.collectedAt
      for (const game of snapshot.games) if (number(game.recentMinutes) !== null) totals.set(game.id, game.recentMinutes)
    } else if (platform === 'psn') {
      summary.from = new Date(start).toISOString(); summary.to = asOf
      summary.partial = stale || !snapshot.observations?.length
      if (!snapshot.observations?.length) { summary.minutes = null; summary.gaps.push('establishing_baseline') }
      for (const game of snapshot.games) {
        const since = Date.parse(snapshot.observedSince?.[game.id])
        if (!Number.isFinite(since) || since > start) incomplete.add(game.id)
      }
      for (const interval of snapshot.observations || []) {
        const from = Date.parse(interval.from), to = Date.parse(interval.to)
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to > end || to <= start) continue
        if (from < start) {
          for (const game of interval.games) if (game.minutes > 0) { incomplete.add(game.id); summary.gaps.push('boundary_interval_omitted') }
          continue
        }
        for (const id of interval.unknownGames || []) incomplete.add(id)
        for (const game of interval.games) if (number(game.minutes) !== null) totals.set(game.id, (totals.get(game.id) || 0) + game.minutes)
      }
      summary.partial ||= incomplete.size > 0
      if (incomplete.size) summary.gaps.push('incomplete_game_baseline')
    } else {
      summary.from = firstDay; summary.to = today
      // Sparse provider dates and delayed uploads do not prove zero play on missing days.
      summary.partial = true
      summary.gaps.push('daily_granularity', 'sparse_provider_dates', 'provider_delay_possible')
      const days = new Map((snapshot.days || []).map(day => [day.date, day]))
      for (const [date, day] of days) if (date >= firstDay && date <= today) {
        for (const game of day.games) if (number(game.minutes) !== null) totals.set(game.id, (totals.get(game.id) || 0) + game.minutes)
      }
    }
    for (const game of snapshot.games) {
      const minutes = totals.get(game.id) || 0
      if (minutes <= 0) continue
      const delayedPlayDate = platform === 'psn' && game.lastPlayedAt && Date.parse(game.lastPlayedAt) <= start
      if (delayedPlayDate) summary.gaps.push('play_date_outside_window')
      rows.push({ ...game, platform, key: `${platform}:${game.id}`, minutes, method: summary.method,
        partial: summary.partial || incomplete.has(game.id), delayedPlayDate: !!delayedPlayDate, stale, collectedAt: snapshot.collectedAt })
      summary.minutes = (summary.minutes || 0) + minutes
    }
  }
  rows.sort((a, b) => b.minutes - a.minutes || (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || '') || a.key.localeCompare(b.key))
  const hasData = Object.values(summaries).some(summary => summary.minutes !== null)
  return { asOf, from: new Date(start).toISOString(), to: asOf, timeZone, firstDay, today, rows,
    featured: rows.slice(0, 3), secondary: rows.slice(3, 7), totalMinutes: hasData ? rows.reduce((sum, row) => sum + row.minutes, 0) : null, summaries }
}
