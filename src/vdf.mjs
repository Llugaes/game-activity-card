// Steam 文本 KeyValues；复用本人 game-journal 项目的解析方式。
export function parseKeyValues(text) {
  const tokens = [], pattern = /\s+|\/\/[^\n]*|"(?:\\.|[^"\\])*"|[{}]/gy
  let offset = 0, cursor = 0
  while (offset < text.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(text)
    if (!match) throw new Error('VDF 格式无效')
    offset = pattern.lastIndex
    if (!/^\s|^\/\//.test(match[0])) tokens.push(match[0])
  }
  function string(token) {
    if (!token?.startsWith('"')) throw new Error('VDF 字符串缺失')
    return token.slice(1, -1).replace(/\\([\\"nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c))
  }
  function object(nested = false) {
    const result = Object.create(null)
    while (cursor < tokens.length && tokens[cursor] !== '}') {
      const key = string(tokens[cursor++]), token = tokens[cursor++]
      if (Object.hasOwn(result, key)) throw new Error('VDF 字段重复')
      result[key] = token === '{' ? object(true) : string(token)
    }
    if (nested && tokens[cursor++] !== '}') throw new Error('VDF 括号未闭合')
    return result
  }
  const result = object()
  if (cursor !== tokens.length) throw new Error('VDF 多余内容')
  return result
}

export function localRecentGames(text, at, excluded = {}) {
  const find = (object, key) => object?.[Object.keys(object || {}).find(k => k.toLowerCase() === key.toLowerCase())]
  let apps = parseKeyValues(text)
  for (const key of ['UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps']) apps = find(apps, key)
  if (!apps) throw new Error('Steam 游戏记录缺失')
  return Object.entries(apps).filter(([id, g]) => /^\d+$/.test(id) && !Object.hasOwn(excluded, id)
    && Number(g.Playtime2wks) > 0 && Number(g.LastPlayed) * 1000 >= Date.parse(at) - 14 * 86400000)
    .map(([id, g]) => ({ appid: Number(id), name: `Steam ${id}`, playtime_forever: Number(g.Playtime),
      playtime_2weeks: Number(g.Playtime2wks), rtime_last_played: Number(g.LastPlayed) }))
}
