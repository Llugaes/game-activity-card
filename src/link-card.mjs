export function linkCard(readme, revision, { repository, outputDir = 'assets' }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('invalid_revision')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('invalid_repository')
  const assetPath = outputDir.replace(/\\/g, '/').replace(/^\.\//, '')
  if (assetPath.split('/').some(part => !part || part === '..') || assetPath.startsWith('/')) throw new Error('invalid_output_dir')
  let matches = 0
  const updated = readme.replace(/((?:src|srcset)=")(?:\.\/[^"?]*\/|https:\/\/raw\.githubusercontent\.com\/[^"?]*\/)(player-log(?:-mobile)?)\.(?:svg|webp)(?:\?v=[a-f0-9]+)?(")/g,
    (_, prefix, file, suffix) => { matches++; return `${prefix}https://raw.githubusercontent.com/${repository}/${revision}/${assetPath.split('/').map(encodeURIComponent).join('/')}/${file}.webp${suffix}` })
  if (matches !== 2) throw new Error('readme_card_links_not_found')
  return updated
}
