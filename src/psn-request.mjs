import { SyncError } from './model.mjs'
export async function psnRequest(stage, request) {
  const originalFetch = globalThis.fetch
  let observedStatus, contentType
  // psn-api 未保留 HTTP 状态；串行调用期间只记录状态及响应类型，不记录 URL、请求头或正文。
  globalThis.fetch = async (input, options) => {
    const response = await originalFetch(input, { ...options, signal: options?.signal || AbortSignal.timeout(25000) })
    observedStatus = response.status
    contentType = response.headers.get('content-type')?.includes('json') ? 'json' : 'non-json'
    if (!response.ok && response.status !== 302) throw new SyncError(response.status === 401 ? 'auth_required' : 'unavailable')
    return response
  }
  try {
    const result = await request()
    if (result?.error) throw new SyncError('unavailable')
    return result
  } catch (error) {
    const status = Number(observedStatus ?? error?.response?.status ?? error?.status ?? error?.statusCode)
    const failure = error instanceof SyncError ? error : new SyncError(status === 401 ? 'auth_required' : 'unavailable')
    failure.stage = stage
    if (Number.isInteger(status) && status >= 100 && status <= 599) failure.httpStatus = status
    if (contentType) failure.responseType = contentType
    throw failure
  } finally { globalThis.fetch = originalFetch }
}
