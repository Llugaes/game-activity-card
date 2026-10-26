import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyData, acceptSnapshot, failedSnapshot } from '../src/model.mjs'
import { activityWindow } from '../src/window.mjs'
import { renderSvg } from '../src/card.mjs'
import { collectActivity } from '../src/collect.mjs'

export const asOf = '2026-10-27T01:00:00.000Z'
const start = '2026-10-13T01:00:00.000Z'
const snapshot = (games, collectedAt = asOf) => ({ source: 'psn-api', account: 'sample', status: 'synced', collectedAt, games })
const game = (id, minutes, extra = {}) => ({ id, title: `Game ${id}`, totalMinutes: minutes, lastPlayedAt: asOf, ...extra })
const receive = (before, current) => acceptSnapshot(before, current, 'psn').snapshot
export function mixedData(count = 8) {
  const data = emptyData()
  data.platforms.steam = { source: 'steam-api', account: 'sample', status: 'synced', collectedAt: asOf,
    games: [game('same', 999, { recentMinutes: 400 }), game('s2', 800, { recentMinutes: 300 }), game('s3', 500, { recentMinutes: 250 })] }
  let psn = receive(undefined, snapshot([game('same', 100), game('p2', 100), game('p3', 100)], start))
  psn = receive(psn, snapshot([game('same', 450), game('p2', 380), game('p3', 200)]))
  data.platforms.psn = psn
  data.platforms.switch = { source: 'nintendo-history', accountScope: 'hash', status: 'synced', collectedAt: asOf,
    games: [game('n1', 900), game('n2', 1000)], days: [{ date: '2026-10-26', games: [{ id: 'n1', minutes: 500 }, { id: 'n2', minutes: 60 }] }] }
  if (count < 8) {
    let remaining = count
    for (const platform of ['steam', 'psn', 'switch']) { data.platforms[platform].games = data.platforms[platform].games.slice(0, remaining); remaining -= data.platforms[platform].games.length }
  }
  return data
}
test('三平台统一排名、同名同ID不合并，总计包含第八款', () => {
  const view = activityWindow(mixedData(), { asOf })
  assert.deepEqual(view.rows.map(row => row.key), ['switch:n1', 'steam:same', 'psn:same', 'steam:s2', 'psn:p2', 'steam:s3', 'psn:p3', 'switch:n2'])
  assert.equal(view.totalMinutes, 2240)
  assert.equal(view.featured.length, 3); assert.equal(view.secondary.length, 4)
  assert.equal(view.rows[0].method, 'daily'); assert.equal(view.rows[2].method, 'observed')
})
test('三个大槽可以全部来自Steam，零值和旧游戏不补位', () => {
  const data = mixedData(); data.platforms.psn = { status: 'pending', games: [] }; data.platforms.switch = { status: 'pending', games: [] }
  const view = activityWindow(data, { asOf })
  assert.deepEqual(view.featured.map(row => row.platform), ['steam', 'steam', 'steam'])
  const svg = renderSvg(data, {}, false, { asOf })
  const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, 3)
  for (const n of [0, 1, 3, 4, 7, 8]) {
    const example = mixedData(n), projected = activityWindow(example, { asOf })
    assert.equal(projected.rows.length, n)
    assert.equal(projected.secondary.length, Math.max(0, Math.min(n - 3, 4)))
    assert.doesNotThrow(() => renderSvg(example, {}, true, { asOf }))
  }
})
test('同分依最近游玩和platform:id稳定排序', () => {
  const data = emptyData(); data.platforms.steam = { status: 'synced', collectedAt: asOf, games: [game('b', 10, { recentMinutes: 10 }), game('a', 10, { recentMinutes: 10 })] }
  assert.deepEqual(activityWindow(data, { asOf }).rows.map(row => row.id), ['a', 'b'])
  data.platforms.steam.games[0].lastPlayedAt = '2026-10-27T01:00:01Z'
  assert.equal(activityWindow(data, { asOf }).rows[0].id, 'b')
})
test('PSN首次、新游戏、累计缺失与回退不制造近期，保留旧已知增量', () => {
  const first = receive(undefined, snapshot([game('a', 100)], start))
  assert.equal(first.observations.length, 0)
  let next = receive(first, snapshot([game('a', 120), game('new', 900), game('missing', null)], '2026-10-14T01:00:00Z'))
  assert.equal(next.observations[0].games[0].minutes, 20)
  assert.deepEqual(next.observations[0].unknownGames, ['new', 'missing'])
  next = receive(next, snapshot([game('a', 1), game('new', 920), game('missing', 99)]))
  assert.equal(next.observations.length, 2)
  const data = emptyData(); data.platforms.psn = next
  assert.deepEqual(activityWindow(data, { asOf }).rows.map(row => [row.id, row.minutes]), [['a', 20], ['new', 20]])
})
test('PSN换账号或来源清历史，失败不推进基线，重复倒序不累计', () => {
  let before = receive(undefined, snapshot([game('a', 100)], start))
  const next = snapshot([game('a', 120)])
  const success = receive(failedSnapshot(before, 'unavailable'), next)
  assert.equal(success.observations[0].games[0].minutes, 20)
  assert.equal(receive(success, next), success)
  assert.equal(receive(success, snapshot([game('a', 200)], start)), success)
  for (const change of [{ account: 'other' }, { source: 'other' }]) {
    const changed = receive(success, { ...snapshot([game('a', 500)], '2026-10-28T01:00:00Z'), ...change })
    assert.equal(changed.observations.length, 0)
  }
})
test('PSN跨窗口边界不摊分，完整区间可计入并标缺口', () => {
  const data = emptyData()
  let psn = receive(undefined, snapshot([game('a', 100)], '2026-10-12T23:00:00Z'))
  psn = receive(psn, snapshot([game('a', 500)], '2026-10-13T03:00:00Z'))
  data.platforms.psn = receive(psn, snapshot([game('a', 520)]))
  const view = activityWindow(data, { asOf })
  assert.equal(view.rows[0].minutes, 20); assert.equal(view.rows[0].partial, true)
  data.platforms.psn.games[0].lastPlayedAt = '2026-10-01T00:00:00Z'
  const delayed = activityWindow(data, { asOf })
  assert.equal(delayed.rows[0].minutes, 20)
  assert.equal(delayed.rows[0].delayedPlayDate, true)
  assert.ok(delayed.summaries.psn.gaps.includes('play_date_outside_window'))
})
test('Steam冻结窗口排除；PSN与Switch窗口内已知值可保留并标过期', () => {
  const data = mixedData()
  for (const key of ['steam', 'psn', 'switch']) data.platforms[key].status = 'stale'
  const view = activityWindow(data, { asOf })
  assert.ok(view.rows.every(row => row.platform !== 'steam' && row.stale && row.partial))
  assert.equal(view.summaries.steam.minutes, null)
  const fresh = mixedData()
  fresh.platforms.steam.collectedAt = '2026-10-26T02:00:00Z'
  assert.equal(activityWindow(fresh, { asOf }).summaries.steam.to, '2026-10-26T02:00:00Z')
  fresh.platforms.steam.collectedAt = '2026-10-26T00:59:00Z'
  assert.ok(activityWindow(fresh, { asOf }).rows.every(row => row.platform !== 'steam'))
})
test('Nintendo保留平台日期，包含14个日期且排除未来和窗口外数据', () => {
  const data = mixedData(); data.platforms.steam.games = []; data.platforms.psn.games = []
  data.platforms.switch.days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-27', '2026-10-28'].map(date => ({ date, games: [{ id: 'n1', minutes: 10 }] }))
  const view = activityWindow(data, { asOf, timeZone: 'Asia/Shanghai' })
  assert.equal(view.firstDay, '2026-10-14'); assert.equal(view.rows[0].minutes, 20)
  const midnight = activityWindow(data, { asOf: '2026-10-26T16:01:00Z', timeZone: 'Asia/Shanghai' })
  assert.equal(midnight.today, '2026-10-27')
})
test('全未连接显示未知，已连接但没有正记录不补历史', () => {
  assert.equal(activityWindow(emptyData(), { asOf }).totalMinutes, null)
  const data = mixedData(0)
  assert.equal(activityWindow(data, { asOf }).totalMinutes, 0)
  assert.ok(renderSvg(data, {}, true, { asOf }).includes('近14天暂无'))
})
test('一平台采集失败不阻断其他平台，账号配置切换后不展示旧账号', async () => {
  const data = mixedData()
  const result = await collectActivity({ data, config: { steamId: 'new', psnOnlineId: 'sample' }, env: {}, at: '2026-10-27T02:00:00Z',
    collectors: { steam: async () => { throw Object.assign(new Error('secret-must-not-appear'), { code: 'auth_required' }) },
      psn: async () => snapshot([game('p', 99)], '2026-10-27T02:00:00Z'), switch: async () => data.platforms.switch } })
  assert.equal(result.failures, 1)
  assert.deepEqual(result.data.platforms.steam.games, [])
  assert.equal(result.data.platforms.psn.games[0].id, 'p')
  assert.ok(!JSON.stringify(result).includes('secret-must-not-appear'))
})
