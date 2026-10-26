import test from 'node:test'
import assert from 'node:assert/strict'
import { seal, unseal, psnAuthorization } from '../src/psn-auth.mjs'
import { nintendoHistory, collectNintendo, nintendoClient, nintendoScope, schemaShape } from '../src/nintendo.mjs'
import { createLogin, callbackCode } from '../src/connect-nintendo.mjs'

const at = '2026-10-11T08:00:00.000Z'
const config = { psnOnlineId: 'SamplePlayer' }
test('PSN 会话加密且绑定账号；错误密钥和篡改被拒绝', () => {
  const value = { refreshToken: 'private-refresh-value', accessToken: 'private-access-value' }
  const encrypted = seal(value, 'secret-value', 'SamplePlayer')
  assert.ok(!JSON.stringify(encrypted).includes('private-'))
  assert.deepEqual(unseal(encrypted, 'secret-value', 'SamplePlayer'), value)
  assert.throws(() => unseal(encrypted, 'different-secret', 'SamplePlayer'))
  assert.throws(() => unseal(encrypted, 'secret-value', 'different-account'))
  assert.throws(() => unseal({ ...encrypted, tag: Buffer.alloc(16).toString('base64') }, 'secret-value', 'SamplePlayer'))
})
test('过期 access token 使用 refresh token 续期并保存新密文', async () => {
  const now = Date.parse(at), env = { PSN_NPSSO: 'secret-value' }
  const old = { accessToken: 'old', refreshToken: 'refresh', accessExpiresAt: now - 1, refreshExpiresAt: now + 999999 }
  let saved
  const auth = await psnAuthorization({ env, config, at,
    readVault: async () => seal(old, env.PSN_NPSSO, config.psnOnlineId), writeVault: async value => { saved = value },
    api: { exchangeRefreshTokenForAuthTokens: async token => { assert.equal(token, 'refresh'); return { accessToken: 'new', refreshToken: 'new-refresh', expiresIn: 3600, refreshTokenExpiresIn: 10000 } },
      exchangeNpssoForAccessCode: async () => { throw Error('不应重新登录') },
      getUserTrophyProfileSummary: async () => ({ accountId: '123456789' }),
      getProfileFromAccountId: async (_, account) => { assert.equal(account, '123456789'); return { onlineId: 'SamplePlayer' } } }
  })
  assert.equal(auth.accessToken, 'new')
  assert.equal(unseal(saved, env.PSN_NPSSO, config.psnOnlineId).refreshToken, 'new-refresh')
})
test('仍有效的会话不刷新、不重复写密文', async () => {
  const cached = { accessToken: 'valid', refreshToken: 'refresh', accessExpiresAt: Date.parse(at) + 3600000 }
  const auth = await psnAuthorization({ env: { PSN_NPSSO: 'secret' }, config, at,
    readVault: async () => seal(cached, 'secret', config.psnOnlineId), writeVault: async () => { throw Error('不应写入') },
    api: { getUserTrophyProfileSummary: async () => ({ accountId: '123456789' }), getProfileFromAccountId: async () => ({ onlineId: 'SamplePlayer' }) } })
  assert.equal(auth.accessToken, 'valid')
})
const history = { playHistories: [
  { titleId: '1', titleName: 'Game', totalPlayedMinutes: 360, lastPlayedAt: at },
  { titleId: 'hidden', titleName: 'Private', totalPlayedMinutes: 500 }
], hiddenTitleList: ['hidden'], recentPlayHistories: [{ playedDate: '2026-10-10', dailyPlayHistories: [
  { titleId: '1', totalPlayedMinutes: 30 }, { titleId: 'hidden', totalPlayedMinutes: 90 }
] }], lastUpdatedAt: at }
test('Nintendo 隐藏游戏不公开，保留平台实际日期和分钟', () => {
  const result = nintendoHistory(history)
  assert.equal(result.games.length, 1)
  assert.equal(result.days[0].minutes, 30)
  assert.equal(result.days[0].date, '2026-10-10')
  assert.throws(() => nintendoHistory({ ...history, playHistories: null }))
  assert.throws(() => nintendoHistory({ ...history, hiddenTitleList: [{ unknownField: 'hidden' }] }))
  assert.equal(nintendoHistory({ ...history, hiddenTitleList: [{ titleId: 'hidden' }] }).games.length, 1)
})
test('Nintendo 重复采集同一天是修正，不能重复累计', async () => {
  const result = await collectNintendo({ env: { NINTENDO_SESSION_TOKEN: 'session-secret' }, at,
    previous: { source: 'nintendo-history', accountScope: nintendoScope({}, 'session-secret'), days: [{ date: '2026-10-10', minutes: 10, games: [] }] },
    fetcher: async (url, options) => {
      if (url.includes('/api/token')) return { ok: true, json: async () => ({ access_token: 'access-secret' }) }
      assert.equal(options.headers.Authorization, 'Bearer access-secret')
      return { ok: true, json: async () => history }
    } })
  assert.equal(result.days.length, 1)
  assert.equal(result.days[0].minutes, 30)
  assert.ok(!JSON.stringify(result).includes('secret'))
})

test('Nintendo 日期兼容时间戳标签，不因时区把游玩日挪到前一天', () => {
  const value = { ...history, recentPlayHistories: [{ ...history.recentPlayHistories[0], playedDate: '2026-10-10T00:00:00+09:00' }] }
  assert.equal(nintendoHistory(value).days[0].date, '2026-10-10')
  assert.throws(() => nintendoHistory({ ...value, recentPlayHistories: [{ playedDate: '2026-02-30', dailyPlayHistories: [] }] }))
})

test('Nintendo 换号隔离历史，后来隐藏的游戏也从保留日记录移除', async () => {
  const env = { NINTENDO_SESSION_TOKEN: 'session-secret' }
  const previous = { source: 'nintendo-history', accountScope: nintendoScope({}, 'session-secret'), days: [{ date: '2026-10-09', minutes: 99, games: [{ id: 'hidden', minutes: 90 }, { id: '1', minutes: 9 }] }] }
  const fetcher = async url => ({ ok: true, json: async () => url.includes('/api/token') ? { access_token: 'access-secret' } : history })
  const same = await collectNintendo({ env, previous, fetcher, at })
  assert.equal(same.days[0].minutes, 9)
  assert.equal(same.days[0].games.length, 1)
  const changed = await collectNintendo({ env: { NINTENDO_SESSION_TOKEN: 'other-account' }, previous, fetcher, at })
  assert.equal(changed.days.length, 1)
  assert.equal(changed.days[0].date, '2026-10-10')
  assert.ok(!JSON.stringify(schemaShape({ token: 'secret', profile: { email: 'private@email' } })).includes('private@email'))
})
test('Nintendo 登录链接使用 PKCE，回调必须匹配这次登录', () => {
  const login = createLogin(), url = new URL(login.url)
  assert.equal(url.hostname, 'accounts.nintendo.com')
  assert.equal(url.searchParams.get('session_token_code_challenge_method'), 'S256')
  assert.equal(callbackCode(`npf${nintendoClient}://auth#state=${login.state}&session_token_code=test-code`, login.state), 'test-code')
  assert.throws(() => callbackCode(`npf${nintendoClient}://auth#state=wrong&session_token_code=test-code`, login.state))
  assert.throws(() => callbackCode(`https://evil.example/#state=${login.state}&session_token_code=test-code`, login.state))
})
