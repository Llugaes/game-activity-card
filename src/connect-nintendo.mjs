import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { nintendoClient, nintendoAgent, nintendoJson } from './nintendo.mjs'

export function createLogin() {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url')
  const url = new URL('https://accounts.nintendo.com/connect/1.0.0/authorize')
  url.search = new URLSearchParams({ state, client_id: nintendoClient, redirect_uri: `npf${nintendoClient}://auth`,
    scope: 'openid user user.mii user.email user.links[].id', response_type: 'session_token_code',
    session_token_code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    session_token_code_challenge_method: 'S256', theme: 'login_form' }).toString()
  return { url: url.href, state, verifier }
}
export function callbackCode(value, expectedState) {
  const url = new URL(value)
  if (url.protocol !== `npf${nintendoClient}:` || url.hostname !== 'auth' || url.username || url.password) throw new Error('invalid_callback')
  const params = new URLSearchParams(url.hash.slice(1))
  if (params.get('state') !== expectedState || !params.get('session_token_code')) throw new Error('invalid_state')
  return params.get('session_token_code')
}

function saveSecret(token, repository) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['secret', 'set', 'NINTENDO_SESSION_TOKEN', '--repo', repository], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', () => reject(new Error('github_write_failed')))
    child.on('close', code => code === 0 ? resolve() : reject(new Error('github_write_failed')))
    child.stdin.on('error', () => reject(new Error('github_write_failed')))
    child.stdin.end(token)
  })
}

export function startConnection(port = 4319, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('invalid_repository')
  const origin = `http://127.0.0.1:${port}`, login = createLogin()
  let busy = false, finished = false
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>连接 Nintendo</title>
  <style>body{background:#10252e;color:#edf4f0;font:16px/1.7 system-ui;padding:24px}main{max-width:620px;margin:4vh auto}h1{font-size:30px}a{color:#9bdac5}button,input{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;padding:14px;margin:10px 0}input{background:#0a1a22;color:#fff;border:1px solid #557a83}button{border:0;background:#9bdac5;color:#112c30;cursor:pointer}small{color:#aac0c3}#result{min-height:2em}</style>
  <main><p>GAME ACTIVITY CARD</p><h1>连接 Nintendo 游戏记录</h1><p>这个页面只在你的电脑运行。授权用于读取 Nintendo Store 的游戏历史，不添加好友，也不修改主机设置。</p>
  <ol><li><a href="${login.url.replace(/&/g, '&amp;')}" target="_blank" rel="noopener noreferrer">打开 Nintendo 官方登录页</a>，用自己的账号登录。</li>
  <li>在“选择此账号 / Select this account”按钮上点右键，复制链接地址。不要直接点进 App。</li><li>将复制的链接粘贴到下面，点击连接。</li></ol>
  <form id="connect"><label for="callback">Nintendo 返回的账号选择链接</label><input id="callback" type="password" autocomplete="off" spellcheck="false" required placeholder="npf…://auth#…"><button>连接并保存到 GitHub Secret</button></form>
  <p id="result" role="status" aria-live="polite"></p><small>凭据直接存入 ${repository} 的 NINTENDO_SESSION_TOKEN Secret。只向 Nintendo 换取令牌并向 GitHub 保存，不写入仓库文件、不发送到聊天。请在保存后运行游戏记录工作流。</small></main>
  <script>document.querySelector('#connect').onsubmit=async e=>{e.preventDefault();const input=document.querySelector('#callback'),button=document.querySelector('button'),result=document.querySelector('#result');button.disabled=true;result.textContent='正在连接…';try{const response=await fetch('/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:input.value})});input.value='';const data=await response.json();result.textContent=data.ok?'已连接并保存。可以关闭本页，回到聊天告诉我“已连接 Nintendo”。':data.error;}catch{result.textContent='本机连接服务不可用，请回到聊天重新开启。';}finally{button.disabled=false}};</script></html>`
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'no-referrer')
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403); return response.end() }
    if (request.method === 'GET' && request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); return response.end(page) }
    if (request.method !== 'POST' || request.url !== '/exchange' || request.headers.origin !== origin
      || request.headers['content-type'] !== 'application/json' || busy || finished) { response.writeHead(403); return response.end() }
    busy = true
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    try {
      let body = ''
      for await (const chunk of request) { body += chunk.toString(); if (body.length > 8192) throw new Error('invalid_callback') }
      const code = callbackCode(JSON.parse(body).url, login.state)
      const result = await nintendoJson('https://accounts.nintendo.com/connect/1.0.0/api/session_token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': nintendoAgent, 'X-Platform': 'Android' },
        body: new URLSearchParams({ client_id: nintendoClient, session_token_code: code, session_token_code_verifier: login.verifier }).toString()
      })
      if (typeof result.session_token !== 'string' || result.session_token.length < 32) throw new Error('invalid_token')
      await saveSecret(result.session_token, repository)
      finished = true
      response.end(JSON.stringify({ ok: true }))
      console.log('Nintendo 凭据已保存到 GitHub Secret。未输出或保存明文令牌。')
    } catch { response.statusCode = 400; response.end(JSON.stringify({ ok: false, error: '连接未完成。请确认链接来自本次 Nintendo 登录；如果已点过账号按钮，请重开本机连接入口。' })) }
    finally { busy = false }
  })
  server.listen(port, '127.0.0.1', () => console.log(`Nintendo 连接入口：${origin}（仅本机，30 分钟后关闭）`))
  const expiry = setTimeout(() => server.close(), 30 * 60 * 1000)
  server.on('close', () => clearTimeout(expiry))
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startConnection(4319, process.env.GITHUB_REPOSITORY)
