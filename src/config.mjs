export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid_config')
  if (config.steamId && !/^\d{17}$/.test(config.steamId)) throw new Error('invalid_steam_id')
  if (config.psnOnlineId && !/^[a-zA-Z0-9_-]{3,16}$/.test(config.psnOnlineId)) throw new Error('invalid_psn_id')
  if (config.name !== undefined && (typeof config.name !== 'string' || config.name.length > 80)) throw new Error('invalid_name')
  const timeZone = config.timeZone || 'UTC'
  new Intl.DateTimeFormat('en', { timeZone })
  return { ...config, timeZone, excludedSteamApps: config.excludedSteamApps || {} }
}
