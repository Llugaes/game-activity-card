import { readFileSync } from 'node:fs'
import { coverKey } from './covers.mjs'
import { activityWindow, platformNames, platforms } from './window.mjs'

export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
export const hours = value => value == null ? '—' : value > 0 && value < 6 ? '<0.1' : (value / 60).toFixed(1)
export const statusText = p => p?.reason === 'auth_required' ? '需要重新授权' : ({ local: '本机记录', synced: '已连接', stale: '更新中断', pending: '待连接' }[p?.status] || '待连接')
const colors = { ink: '#f4f4ed', quiet: '#a5aaa9', line: '#323738', base: '#0d1117', steam: '#d4ff73', psn: '#8fbaff', switch: '#ff9a82' }
const icons = Object.fromEntries(['steam', 'playstation', 'nintendoswitch'].map(name => [name, readFileSync(new URL(`../assets/icons/${name}.svg`, import.meta.url), 'utf8').match(/<path d="([^"]+)"/)[1]]))
const logos = { steam: 'steam', psn: 'playstation', switch: 'nintendoswitch' }
const t = (x, y, value, size = 16, color = colors.ink, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${escape(value)}</text>`
const icon = (platform, x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 24})"><path d="${icons[logos[platform]]}" fill="${colors[platform]}"/></g>`
const length = value => [...String(value)].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0)
function short(value, limit) {
  let size = 0, out = ''
  for (const char of String(value)) { size += length(char); if (size > limit) return out + '…'; out += char }
  return out
}
function titleLines(value, limit) {
  const lines = []; let current = ''
  for (const word of String(value).split(/\s+/u).filter(Boolean)) {
    const join = current ? ' ' : ''
    if (length(current + join + word) > limit && current) { lines.push(current); current = word }
    else current += join + word
  }
  if (current) lines.push(current)
  return [short(lines[0] || '', limit), short(lines.slice(1).join(' '), limit)]
}
function image(covers, key, x, y, w, h, id) {
  const uri = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(covers[key] || '') ? covers[key] : null
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/></clipPath>` + (uri
    ? `<image href="${uri}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#22282b"/>${t(x + 15, y + h / 2, 'NO COVER', 16, colors.quiet, 'class="mono"')}`)
}
const methodText = row => row.method === 'observed' ? '近14天 · 观测新增' : row.method === 'daily' ? '近14日 · 平台日记录' : '近14天 · 平台记录'
function gameCard(game, covers, x, y, width, mobile, index) {
  const accent = colors[game.platform], height = mobile ? 318 : 340, artHeight = mobile ? 142 : 165, artBottom = 42 + artHeight
  const title = titleLines(game.title, mobile ? 29 : 25), art = `art-${index}`
  return `<g transform="translate(${x} ${y})"><g class="enter enter-${index}">
    <path d="M8 ${height + 4}H${width + 4}V18" fill="none" stroke="#000" stroke-width="9" opacity=".35"/>
    <path d="M0 10L10 0H${width - 15}L${width} 15V${height - 10}L${width - 10} ${height}H0Z" fill="url(#shell)" stroke="${accent}" stroke-opacity=".65"/>
    <path d="M${width - 15} 0V15H${width}" fill="none" stroke="#697073"/>
    ${icon(game.platform, 13, 12, 18)}${t(39, 26, platformNames[game.platform].toUpperCase(), 13, colors.ink, 'class="mono" font-weight="700" letter-spacing="1"')}
    ${t(width - 13, 26, String(index + 1).padStart(2, '0'), 12, colors.quiet, 'class="mono" text-anchor="end"')}
    ${image(covers, coverKey(game.platform, game), 10, 42, width - 20, artHeight, art)}
    <path d="M12 ${artBottom - 16}V${artBottom - 2}H26M${width - 26} 44H${width - 12}V58" fill="none" stroke="${accent}" stroke-width="2"/>
    ${t(14, artBottom + 27, title[0], 17, colors.ink, 'font-weight="650"')}${title[1] ? t(14, artBottom + 49, title[1], 16, colors.ink) : ''}
    ${t(14, height - 37, hours(game.minutes), mobile ? 35 : 42, accent, 'class="number" font-weight="700"')}${t(width - 14, height - 42, 'h', 19, accent, 'text-anchor="end"')}
    ${t(14, height - 15, methodText(game), 11, colors.quiet)}${t(width - 14, height - 15, game.stale ? '上次记录' : `累计 ${hours(game.totalMinutes)} h`, 10, colors.quiet, 'text-anchor="end"')}
    </g></g>`
}
function secondaryGames(games, covers, y, width, mobile) {
  let content = t(24, y, 'ALSO PLAYED', 12, colors.quiet, 'class="mono" letter-spacing="2"')
  const columns = mobile ? 2 : 4, gap = mobile ? 12 : 16, itemW = (width - 48 - (columns - 1) * gap) / columns
  for (const [i, game] of games.entries()) {
    const x = 24 + i % columns * (itemW + gap), top = y + 16 + Math.floor(i / columns) * 112
    content += image(covers, coverKey(game.platform, game), x, top, itemW, 58, `small-${i}`)
      + `<rect x="${x}" y="${top + 38}" width="${itemW}" height="20" fill="#080b0e" opacity=".9"/>`
      + icon(game.platform, x + 5, top + 41, 14)
      + t(x + itemW - 6, top + 52, `${hours(game.minutes)} h`, 12, colors[game.platform], 'class="mono" text-anchor="end"')
      + `<path d="M${x} ${top + 58}h${itemW}" stroke="${colors[game.platform]}"/>`
      + t(x, top + 77, short(game.title, mobile ? 18 : 24), 12, colors.quiet)
      + t(x, top + 94, `${String(i + 4).padStart(2, '0')} · ${platformNames[game.platform]}${game.stale ? ' · 上次记录' : ''}`, 10, colors.quiet)
  }
  return content
}
export function renderSvg(data, covers = {}, mobile = false, options = {}) {
  const view = activityWindow(data, options), width = mobile ? 360 : 920
  const largeBottom = view.featured.length ? (mobile ? 149 + view.featured.length * 330 : 507) : 280
  const smallY = largeBottom + 25, smallRows = Math.ceil(view.secondary.length / (mobile ? 2 : 4))
  const footerY = view.secondary.length ? smallY + 30 + smallRows * 112 : largeBottom + 24
  const height = footerY + (mobile ? 112 : 92)
  const name = options.name || 'PLAYER', total = view.totalMinutes
  const connected = platforms.filter(key => data.platforms?.[key]?.status === 'synced' && !view.summaries[key].stale).length
  let content = t(24, 31, `${short(name.toUpperCase(), mobile ? 17 : 35)} / SAVE SELECT`, mobile ? 9 : 12, colors.quiet, 'class="mono" letter-spacing="1"')
    + t(width - 24, 31, `${connected}/3 CONNECTED`, mobile ? 9 : 12, colors.steam, 'class="mono" text-anchor="end"')
    + t(22, mobile ? 83 : 94, 'CONTINUE', mobile ? 43 : 64, colors.ink, 'font-weight="850" font-style="italic" letter-spacing="-3"')
  if (mobile) content += t(width - 24, 112, `${hours(total)} h / 近14天 · 已记录`, 12, colors.steam, 'text-anchor="end"')
  else content += t(width - 24, 85, `${hours(total)} h`, 45, colors.steam, 'class="number" text-anchor="end" font-weight="700"') + t(width - 24, 108, '近14天 · 平台已记录时长', 12, colors.quiet, 'text-anchor="end"')
  content += `<path d="M24 126H${width - 24}" stroke="${colors.line}"/>`
  let offset = 24
  if (total > 0) for (const game of view.rows) {
    const part = (width - 48) * game.minutes / total
    if (part > 1) content += `<path d="M${offset.toFixed(2)} 126h${Math.max(0, part - 3).toFixed(2)}" stroke="${colors[game.platform]}" stroke-width="3"/>`
    offset += part
  }
  for (const [i, game] of view.featured.entries()) content += gameCard(game, covers, mobile ? 24 : 24 + i * 298, mobile ? 149 + i * 330 : 157, mobile ? 312 : 276, mobile, i)
  if (!view.featured.length) content += t(24, 196, total === null ? '等待连接游戏记录' : '近14天暂无可展示的游玩记录', mobile ? 17 : 22) + t(24, 229, '连接状态与历史覆盖可在全部存档中查看', mobile ? 12 : 14, colors.quiet)
  if (view.secondary.length) content += secondaryGames(view.secondary, covers, smallY, width, mobile)
  for (const [i, key] of platforms.entries()) {
    const summary = view.summaries[key], positionX = mobile ? 24 : 24 + i * 298, positionY = footerY + (mobile ? i * 19 : 0)
    const stamp = summary.collectedAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: options.timeZone || 'UTC', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(summary.collectedAt)) : ''
    content += icon(key, positionX, positionY - 11, 12) + t(positionX + 18, positionY, `${platformNames[key]} · ${summary.stale ? (summary.status === 'synced' ? '数据过期' : statusText(data.platforms?.[key])) : '已连接'}${summary.partial && summary.collectedAt ? ' · 部分记录' : ''} ${stamp}`, 9, colors.quiet)
  }
  content += t(24, height - 33, mobile ? '平台记录合计；PSN 为观测增量，Switch 按日记录。' : '平台记录合计；PSN 为观测增量，Switch 按平台日期，可能延迟。各平台窗口与覆盖见全部存档。', mobile ? 9 : 11, colors.quiet)
    + t(width - 24, height - 12, '全部存档 ↗', 12, colors.ink, 'text-anchor="end"')
  const description = `近14天已记录 ${hours(total)} 小时。${view.rows.map(row => `${platformNames[row.platform]} ${row.title} ${hours(row.minutes)} 小时`).join('。')}。${platforms.map(key => `${platformNames[key]} · ${statusText(data.platforms?.[key])}${view.summaries[key].stale ? '，数据未更新' : ''}`).join('。')}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escape(name)} 的游戏记录</title><desc id="desc">${escape(description)}</desc>
<defs><linearGradient id="shell" x2=".8" y2="1"><stop stop-color="#232b2d"/><stop offset=".24" stop-color="#171d20"/><stop offset="1" stop-color="#111719"/></linearGradient></defs>
<style>.mono{font-family:Consolas,Menlo,monospace}.number{font-family:Arial,Helvetica,sans-serif;font-variant-numeric:tabular-nums}@media(prefers-reduced-motion:no-preference){.enter{animation:load .7s ease-out both}.enter-1{animation-delay:.12s}.enter-2{animation-delay:.24s}@keyframes load{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}}</style>
<rect width="${width}" height="${height}" fill="${colors.base}"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif">${content}</g></svg>\n`
}
