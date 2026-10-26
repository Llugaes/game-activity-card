import { write } from './io.mjs'
import { ensureCovers } from './covers.mjs'
import { renderSvg, hours, statusText } from './card.mjs'
import { activityWindow, platforms, platformNames } from './window.mjs'
const md = value => String(value).replace(/[\r\n]+/g, ' ').replace(/[|]/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const methodName = method => ({ native: '平台原生两周', observed: '采集区间增量', daily: '平台逐日记录' }[method])
export function renderMarkdown(data, options = {}) {
  const view = activityWindow(data, options)
  let output = `# 游戏记录\n\n[返回主页](${options.profileUrl || '../README.md'})\n\n`
    + `近14天平台已记录 **${hours(view.totalMinutes)} 小时**。此数是各平台游玩记录之和，可能包含同时运行或挂起的游戏，不表示实际在线时间。\n\n`
    + `计算时刻：${view.asOf}。Steam 为各自采集时刻结束的原生滚动窗口；PSN 仅包含完整落入近14×24小时的观测区间，边界区间不摊分；Switch 使用 ${view.firstDay} 至 ${view.today} 的平台原日期（显示时区 ${view.timeZone}），可能延迟一天。缺日期不代表已证明零游玩。\n\n`
    + '| 排名 | 平台 | 游戏 | 已记录小时 | 口径 |\n| ---: | :--- | :--- | ---: | :--- |\n'
  output += view.rows.length ? view.rows.map((row, index) => `| ${index + 1} | ${platformNames[row.platform]} | ${md(row.title)} | ${hours(row.minutes)} | ${methodName(row.method)}${row.partial ? ' · 记录不完整' : ''}${row.stale ? ' · 上次记录' : ''} |`).join('\n') + '\n\n' : '\n暂无可计入的近期记录；缺失数据不会填作游戏零时长。\n\n'
  for (const platform of platforms) {
    const snapshot = data.platforms?.[platform] || { games: [] }, summary = view.summaries[platform]
    output += `## ${platformNames[platform]}\n\n${statusText(snapshot)}${summary.stale && snapshot.collectedAt ? ' · 数据未更新' : ''} · 最后成功采集：${snapshot.collectedAt || '尚未采集'}\n\n`
    if (!snapshot.collectedAt) { output += '尚未连接。\n\n'; continue }
    output += `近期口径：${methodName(summary.method)}；区间 ${summary.from || '不可用'} → ${summary.to || '不可用'}；${summary.partial ? '记录不完整，仅统计已知值' : '按已返回记录计算'}。\n\n`
    if (platform === 'steam' && summary.stale) output += 'Steam 上次滚动窗口无法重新裁成当前窗口，已从当前排名和总计排除；下表保留上次结果。\n\n'
    if (platform === 'psn') output += '首次采集、新游戏、缺失累计值和计数回退会建立新基线；累计值不当作近期值。旧的平台聚合区间仅保留审计，不拆造游戏历史。\n\n'
    if (platform === 'psn') output += '近期值表示近14天观测到的累计新增，可能包含历史游玩的迟到补报，不保证实际游玩发生在该窗口内。\n\n'
    if (summary.gaps.includes('play_date_outside_window')) output += '**累计时长新增与最后游玩时间不一致，可能为延迟更新；保留已经观测到的新增。**\n\n'
    if (snapshot.trophies) output += `白金 ${snapshot.trophies.platinum ?? '—'} · 金 ${snapshot.trophies.gold ?? '—'} · 银 ${snapshot.trophies.silver ?? '—'} · 铜 ${snapshot.trophies.bronze ?? '—'}\n\n`
    const byId = new Map(view.rows.filter(row => row.platform === platform).map(row => [row.id, row]))
    output += '| 游戏 | 近期已记录小时 | 累计小时 | 最近游玩 |\n| :--- | ---: | ---: | :--- |\n'
      + (snapshot.games || []).map(game => `| ${md(game.title)} | ${hours(byId.get(game.id)?.minutes ?? (platform === 'steam' ? game.recentMinutes : null))} | ${hours(game.totalMinutes)} | ${game.lastPlayedAt || '—'} |`).join('\n') + '\n\n'
    if (platform === 'switch' && snapshot.days?.length) output += '### 平台逐日记录\n\n| 原日期 | 已记录小时 |\n| :--- | ---: |\n' + snapshot.days.slice(-30).reverse().map(day => `| ${day.date} | ${hours(day.minutes)} |`).join('\n') + '\n\n'
  }
  return output.trimEnd() + '\n'
}
export async function renderWebp(svg) {
  const { default: sharp } = await import('sharp')
  return sharp(Buffer.from(svg), { density: 144 }).webp({ quality: 85, effort: 6 }).toBuffer()
}
export async function renderFiles(data, options = {}) {
  const view = activityWindow(data, options)
  const covers = await ensureCovers(view.rows, { download: !!options.downloadCovers })
  for (const mobile of [false, true]) {
    const svg = renderSvg(data, covers, mobile, options), file = `assets/player-log${mobile ? '-mobile' : ''}`
    await write(`${file}.svg`, svg)
    await write(`${file}.webp`, await renderWebp(svg))
  }
  await write('docs/ACTIVITY.md', renderMarkdown(data, options))
  return view
}
