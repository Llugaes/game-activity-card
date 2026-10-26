import test from 'node:test'
import assert from 'node:assert/strict'
import { steamGames, psnGames, durationMinutes, acceptSnapshot, failedSnapshot, emptyData } from '../src/model.mjs'
import { collectSteam, collectPsn, json } from '../src/collectors.mjs'
import { localRecentGames, parseKeyValues } from '../src/vdf.mjs'
import { renderSvg as coreRenderSvg } from '../src/card.mjs'
import { renderWebp, renderMarkdown } from '../src/render.mjs'
import sharp from 'sharp'
import { linkCard as coreLinkCard } from '../src/link-card.mjs'
const linkCard = (readme, rev) => coreLinkCard(readme, rev, { repository: 'sample/profile' })
const renderSvg = (data, covers = {}, mobile = false) => coreRenderSvg(data, covers, mobile, { asOf: at })

const config = { steamId: '76561198000000000', psnOnlineId: 'SamplePlayer', excludedSteamApps: { '1000002': 'Excluded Tool' } }
const at = '2026-10-11T08:00:00.000Z'
const game = { appid: 1000001, name: 'Synthetic Game', playtime_forever: 3000, playtime_2weeks: 900 }
const snapshot = (minutes, source = 'steam-api', collectedAt = at) => ({ status: 'synced', source, account: config.steamId, collectedAt,
  games: [{ id: '1000001', title: '合成游戏', totalMinutes: minutes, recentMinutes: 900 }] })

test('Steam 过滤软件，只发布白名单字段与中文名', () => {
  const games = steamGames({ total_count: 2, games: [{ ...game, secret: 'do-not-copy' }, { ...game, appid: 1000002 }] }, config, { '1000001': '合成游戏' })
  assert.equal(games.length, 1)
  assert.equal(games[0].title, '合成游戏')
  assert.equal(JSON.stringify(games).includes('do-not-copy'), false)
})
test('Steam 缺失、隐私或截断响应不能冒充零游玩', () => {
  for (const value of [{}, { total_count: 2, games: [game] }, { total_count: 1 }]) assert.throws(() => steamGames(value, config))
  assert.deepEqual(steamGames({ total_count: 0 }, config), [])
})
test('非法时长不能变成零或 NaN', () => {
  assert.throws(() => steamGames({ total_count: 1, games: [{ ...game, playtime_forever: undefined }] }, config))
  assert.equal(durationMinutes('PT228H56M33S'), 13736)
  assert.equal(durationMinutes('P1DT2H3M'), 1563)
  assert.equal(durationMinutes('PT0S'), 0)
  for (const value of ['', 'unknown', 'P', '-5']) assert.equal(durationMinutes(value), null)
  assert.equal(psnGames([{ titleId: 'abc', name: 'Game' }])[0].totalMinutes, null)
})
test('首次导入、更换来源或账号不制造游玩增量', () => {
  assert.equal(acceptSnapshot(undefined, snapshot(3000), 'steam').interval, null)
  const old = snapshot(2900, 'steam-local', '2026-10-10T08:00:00.000Z')
  assert.equal(acceptSnapshot(old, snapshot(3000), 'steam').interval, null)
  assert.equal(acceptSnapshot({ ...old, source: 'steam-api', account: 'other' }, snapshot(3000), 'steam').interval, null)
})
test('跨日增量保留时间区间，新游戏和计数回退不被凭空计入', () => {
  const old = snapshot(2900, 'steam-api', '2026-10-10T08:00:00.000Z')
  const current = snapshot(3000)
  current.games.push({ id: 'new', totalMinutes: 9999 })
  const { interval } = acceptSnapshot(old, current, 'steam')
  assert.equal(interval.minutes, 100)
  assert.equal(interval.newOrResetGames, 1)
  assert.equal(interval.from, old.collectedAt)
  assert.equal(acceptSnapshot(old, snapshot(2800), 'steam').interval, null)
})
test('失败保留数据时间与记录，不泄露异常文本', () => {
  const result = failedSnapshot(snapshot(3000), 'credential=private')
  assert.equal(result.collectedAt, at)
  assert.equal(result.status, 'stale')
  assert.equal(result.games[0].totalMinutes, 3000)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(failedSnapshot(undefined, 'missing_secret').status, 'pending')
})
test('Steam HTTP 错误不会回显 key 或私人地址', async () => {
  await assert.rejects(json('https://example.test/?key=private', async () => { throw Error('private') }), { message: 'unavailable' })
  await assert.rejects(collectSteam({ config, env: {}, at }), { code: 'missing_secret' })
})
test('Steam API 请求不限制返回数量，并能读取真实接口形状', async () => {
  const result = await collectSteam({ env: { STEAM_API_KEY: 'test' }, config, at, fetcher: async url => {
    assert.equal(url.searchParams.get('steamid'), config.steamId)
    assert.equal(url.searchParams.get('count'), '0')
    return { ok: true, json: async () => ({ response: { total_count: 1, games: [game] } }) }
  } })
  assert.equal(result.games[0].recentMinutes, 900)
  assert.equal(result.source, 'steam-api')
})
const psnApi = onlineId => ({
  exchangeNpssoForAccessCode: async () => 'code', exchangeAccessCodeForAuthTokens: async () => ({ accessToken: 'private' }),
  getProfileFromAccountId: async (_, account) => { assert.equal(account, '123456789'); return { onlineId, aboutMe: 'private' } },
  getUserPlayedGames: async (_, account, { offset }) => {
    assert.equal(account, '123456789')
    return offset === 0 ? { titles: [{ titleId: 'A', name: 'A', playDuration: 'PT2H' }], totalItemCount: 2, nextOffset: 1 }
      : { titles: [{ titleId: 'B', name: 'B', playDuration: 'PT4H' }], totalItemCount: 2 }
  },
  getUserTrophyProfileSummary: async (_, account) => { assert.equal(account, 'me'); return { accountId: '123456789', earnedTrophies: { platinum: 2, gold: 3, silver: 4, bronze: 5 }, personal: 'private' } }
})
test('PSN 校验本人账号、完整分页且不保留令牌和资料', async () => {
  const result = await collectPsn({ env: { PSN_NPSSO: 'test' }, config, at, api: psnApi('SamplePlayer') })
  assert.equal(result.games.length, 2)
  assert.equal(result.trophies.platinum, 2)
  assert.equal(JSON.stringify(result).includes('private'), false)
  await assert.rejects(collectPsn({ env: { PSN_NPSSO: 'test' }, config, at, api: psnApi('someone-else') }), { code: 'account_mismatch' })
})
test('PSN 截断分页不覆盖成功快照', async () => {
  const api = psnApi('SamplePlayer')
  api.getUserPlayedGames = async () => ({ titles: [], totalItemCount: 5 })
  await assert.rejects(collectPsn({ env: { PSN_NPSSO: 'test' }, config, at, api }), { code: 'incomplete' })
})
test('本机导入排除过期两周计数，只提取游戏字段', () => {
  const vdf = '"UserLocalConfigStore" { "private" "never publish" "Software" { "Valve" { "Steam" { "apps" { "1000001" { "Playtime" "3000" "Playtime2wks" "900" "LastPlayed" "1791690000" } "1" { "Playtime" "3" "Playtime2wks" "3" "LastPlayed" "1" } } } } } }'
  const games = localRecentGames(vdf, at)
  assert.equal(games.length, 1)
  assert.equal(JSON.stringify(games).includes('never publish'), false)
  assert.throws(() => parseKeyValues('"a" { "x" "1" "x" "2" }'))
})
test('SVG 转义游戏名，显示采集来源，不冒充实时状态', () => {
  const data = emptyData()
  data.platforms.steam = snapshot(3000, 'steam-local')
  data.platforms.steam.status = 'local'
  data.platforms.steam.games[0].title = '<script>alert(1)</script>'
  const svg = renderSvg(data)
  assert.ok(renderMarkdown(data, { asOf: at }).includes('&lt;script&gt;'))
  assert.ok(!svg.includes('<script>'))
  assert.ok(svg.includes('本机记录'))
  assert.ok(svg.includes('PlayStation · 待连接'))
})

test('未连接不显示零时长；过期快照保留数据并显示故障', () => {
  const data = emptyData()
  assert.ok(renderSvg(data).includes('— h'))
  assert.ok(renderSvg(data).includes('0/3 CONNECTED'))
  data.platforms.steam = { ...snapshot(3000), status: 'stale', reason: 'auth_required' }
  const svg = renderSvg(data)
  assert.ok(svg.includes('需要重新授权'))
  assert.ok(!svg.includes('>15.0<'))
  assert.ok(!svg.includes('3/3 CONNECTED'))
})

test('发布引用绑定已生成图片的提交，并保留用户正文及自适应选择', () => {
  const readme = '个人正文\n<source media="(max-width:600px)" srcset="./assets/player-log-mobile.svg?v=abc" /><img src="./assets/player-log.svg?v=abc" />'
  const first = linkCard(readme, 'a'.repeat(40)), next = linkCard(first, 'b'.repeat(40))
  assert.ok(next.startsWith('个人正文\n<source media="(max-width:600px)"'))
  assert.equal((next.match(new RegExp('b'.repeat(40), 'g')) || []).length, 2)
  assert.ok(!next.includes('?v='))
  assert.ok(next.includes('player-log.webp'))
  assert.ok(next.includes('player-log-mobile.webp'))
  assert.throws(() => linkCard('个人正文', 'a'.repeat(40)))
  assert.throws(() => linkCard(readme, 'main'))
})

test('电脑和手机版卡片生成可解码的双倍分辨率 WebP', async () => {
  for (const mobile of [false, true]) {
    const svg = renderSvg(emptyData(), {}, mobile)
    const source = await sharp(Buffer.from(svg)).metadata()
    const buffer = await renderWebp(svg)
    const output = await sharp(buffer).metadata()
    assert.equal(output.format, 'webp')
    assert.equal(output.width, source.width * 2)
    assert.equal(output.height, source.height * 2)
    await sharp(buffer).raw().toBuffer()
  }
})
