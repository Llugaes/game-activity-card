import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveFile } from './io.mjs'

const extensions = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export function coverKey(platform, game) { return `${platform}-${game.id}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) }
function allowed(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && ['steamstatic.com', 'playstation.com', 'nintendo.com', 'nintendo.co.jp', 'nintendo.net'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain)) } catch { return false }
}
export async function coverData(key) {
  for (const [ext, mime] of Object.entries(extensions)) {
    try { return `data:${mime};base64,${(await readFile(await resolveFile(`assets/covers/${key}.${ext}`))).toString('base64')}` }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return null
}
export async function ensureCovers(rows, { download = false } = {}) {
  const covers = {}
  await mkdir(path.dirname(await resolveFile('assets/covers/.directory')), { recursive: true })
  for (const game of rows.slice(0, 7)) {
      const platform = game.platform
      const key = coverKey(platform, game)
      covers[key] = await coverData(key)
      if (covers[key]) continue
      if (!download) continue
      try {
        let imageUrl = game.imageUrl
        if (platform === 'steam' && /^\d+$/.test(game.id)) {
          const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${game.id}&l=schinese`, { signal: AbortSignal.timeout(15000), redirect: 'error' })
          const app = (await response.json())[game.id]
          if (app?.success) imageUrl = app.data.header_image
        }
        if (!allowed(imageUrl)) continue
        const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000), redirect: 'error' })
        const mime = response.headers.get('content-type')?.split(';')[0]
        const ext = Object.keys(extensions).find(key => extensions[key] === mime)
        if (!response.ok || !ext || Number(response.headers.get('content-length')) > 2000000) continue
        const chunks = []; let size = 0
        for await (const chunk of response.body) { size += chunk.length; if (size > 2000000) throw Error('image_too_large'); chunks.push(chunk) }
        const buffer = Buffer.concat(chunks)
        const valid = ext === 'jpg' ? buffer[0] === 255 && buffer[1] === 216
          : ext === 'png' ? buffer.subarray(1, 4).toString() === 'PNG' : buffer.subarray(8, 12).toString() === 'WEBP'
        if (!valid) continue
        await writeFile(await resolveFile(`assets/covers/${key}.${ext}`), buffer)
        covers[key] = `data:${mime};base64,${buffer.toString('base64')}`
      } catch { /* 封面异常只降级图片，不影响真实活动数据。 */ }
  }
  return covers
}
