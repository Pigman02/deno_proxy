/**
 * Deno Deploy Proxy (Modern UI + Smart Cache)
 * 极简 UI 设计版 - 只有核心功能，没有花哨的装饰
 */

// --- 缓存系统 ---
let CACHED_CONFIG = null;
let LAST_FETCH_TIME = 0;
const CACHE_TTL_MS = 60 * 1000; // 60秒缓存
// --------------

// 初始化 KV
let kv;
try { kv = await Deno.openKv(); } catch (e) { console.error("KV Init Failed:", e); }

const KEY_CONFIG = ["proxy_config_v1"];
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin";

// 获取配置逻辑 (优先读缓存)
async function getConfig() {
    const now = Date.now();
    if (CACHED_CONFIG && (now - LAST_FETCH_TIME < CACHE_TTL_MS)) {
        return CACHED_CONFIG;
    }
    if (!kv) return { routes: [] };
    try {
        const res = await kv.get(KEY_CONFIG);
        const data = res.value || { routes: [] };
        CACHED_CONFIG = data;
        LAST_FETCH_TIME = now;
        return data;
    } catch (e) {
        return { routes: [] };
    }
}

// 🎨 全新极简 UI 模板
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>控制台</title>
    <style>
        :root { --bg: #fafafa; --card: #ffffff; --border: #eaeaea; --text: #171717; --text-light: #666; --primary: #000; --danger: #e00; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); display: flex; justify-content: center; padding-top: 60px; margin: 0; }
        .container { width: 100%; max-width: 640px; padding: 0 20px; }
        
        /* 头部 */
        .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; }
        h1 { font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.5px; }
        .status-dot { height: 8px; width: 8px; background-color: #10b981; border-radius: 50%; display: inline-block; margin-right: 6px; }
        .subtitle { font-size: 13px; color: var(--text-light); }

        /* 卡片容器 */
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); overflow: hidden; }
        
        /* 列表项 */
        .rule-list { padding: 0; margin: 0; }
        .rule-item { display: flex; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); align-items: center; background: #fff; transition: background 0.2s; }
        .rule-item:last-child { border-bottom: none; }
        .rule-item:hover { background: #fcfcfc; }
        
        /* 输入框 */
        input { border: 1px solid transparent; background: transparent; padding: 8px; font-size: 14px; width: 100%; border-radius: 4px; color: var(--text); outline: none; transition: all 0.2s; }
        input:focus { background: #fff; border-color: #ddd; box-shadow: 0 0 0 2px rgba(0,0,0,0.05); }
        input::placeholder { color: #aaa; }
        
        /* 密码区域 */
        .auth-section { padding: 16px; background: #fbfbfb; border-top: 1px solid var(--border); display: flex; gap: 10px; align-items: center; }
        .auth-input { background: #fff; border: 1px solid var(--border); }

        /* 按钮 */
        button { cursor: pointer; font-size: 13px; font-weight: 500; border-radius: 4px; border: none; transition: opacity 0.2s; }
        button:hover { opacity: 0.8; }
        .btn-icon { background: transparent; color: #999; padding: 8px; font-size: 16px; line-height: 1; }
        .btn-icon:hover { color: var(--danger); background: #fff0f0; }
        .btn-add { width: 100%; padding: 12px; background: #fff; border-bottom: 1px solid var(--border); color: var(--text-light); text-align: center; }
        .btn-add:hover { background: #fafafa; color: var(--primary); }
        .btn-save { background: var(--primary); color: white; padding: 8px 16px; margin-left: auto; }
        .btn-save:disabled { background: #ccc; cursor: not-allowed; }

        /* 消息提示 */
        #msg { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); padding: 10px 20px; border-radius: 30px; background: rgba(0,0,0,0.8); color: white; font-size: 14px; opacity: 0; transition: opacity 0.3s; pointer-events: none; backdrop-filter: blur(4px); }
        #msg.show { opacity: 1; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Proxy</h1>
            <span class="subtitle"><span class="status-dot"></span>Online</span>
        </div>

        <form id="configForm" class="card">
            <div id="rulesList" class="rule-list"></div>
            
            <button type="button" class="btn-add" onclick="addRule()">+ Add Route</button>

            <div class="auth-section">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#888"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <input type="password" id="password" class="auth-input" placeholder="Enter Password (default: admin)" required>
                <button type="submit" class="btn-save" id="saveBtn">Save Changes</button>
            </div>
        </form>
    </div>
    
    <div id="msg">Saved Successfully</div>

    <script>
        function addRule(path = '', target = '') {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.innerHTML = \`
                <div style="flex:1; display:flex; gap:10px; align-items:center;">
                    <span style="color:#aaa; font-size:12px; font-family:monospace;">/</span>
                    <input type="text" name="path" value="\${path.replace(/^\\//, '')}" placeholder="openai" required style="font-family:monospace; font-weight:500;">
                </div>
                <div style="flex:2; display:flex; align-items:center;">
                    <span style="color:#aaa; font-size:14px; margin-right:5px;">→</span>
                    <input type="url" name="target" value="\${target}" placeholder="https://api.openai.com" required>
                </div>
                <button type="button" class="btn-icon" title="Remove" onclick="this.parentElement.remove()">×</button>
            \`;
            document.getElementById('rulesList').appendChild(div);
        }

        function showMsg(text, isError = false) {
            const el = document.getElementById('msg');
            el.innerText = text;
            el.style.background = isError ? 'rgba(220, 38, 38, 0.9)' : 'rgba(0, 0, 0, 0.8)';
            el.classList.add('show');
            setTimeout(() => el.classList.remove('show'), 3000);
        }

        fetch('/api/config').then(res => res.json()).then(data => {
            const rules = data.routes || [];
            if (rules.length) rules.forEach(r => addRule(r.path, r.target));
            else addRule('openai', 'https://api.openai.com'); 
        });

        document.getElementById('configForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('saveBtn');
            btn.disabled = true; btn.innerText = 'Saving...';

            const routes = Array.from(document.querySelectorAll('.rule-item')).map(item => {
                let p = item.querySelector('[name=path]').value.trim();
                // 自动补全前导斜杠
                if(!p.startsWith('/')) p = '/' + p;
                return {
                    path: p,
                    target: item.querySelector('[name=target]').value.trim()
                };
            });

            try {
                const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ routes, password: document.getElementById('password').value })
                });
                
                const data = await res.json();
                if (res.ok) {
                    showMsg('Configuration Saved');
                } else {
                    showMsg(data.error || 'Failed to save', true);
                }
            } catch(e) {
                showMsg('Network Error', true);
            } finally {
                btn.disabled = false; btn.innerText = 'Save Changes';
            }
        });
    </script>
</body>
</html>
`;

async function handleRequest(req) {
  const url = new URL(req.url);

  // WebUI
  if (url.pathname === "/admin") return new Response(HTML_TEMPLATE, { headers: { "content-type": "text/html; charset=utf-8" } });

  // API
  if (url.pathname === "/api/config") {
    if (req.method === "GET") {
        return Response.json(await getConfig());
    }
    if (req.method === "POST") {
        try {
            const body = await req.json();
            if (body.password !== ADMIN_PASSWORD) return Response.json({error:"Invalid Password"}, {status:401});
            
            const newConfig = { routes: body.routes };
            if (kv) await kv.set(KEY_CONFIG, newConfig);
            
            // 更新缓存
            CACHED_CONFIG = newConfig;
            LAST_FETCH_TIME = Date.now();
            
            return Response.json({success:true});
        } catch(e) {
            return Response.json({error:e.message}, {status:500});
        }
    }
  }

  // Proxy Logic
  const config = await getConfig();
  const routes = config.routes || [];
  routes.sort((a, b) => b.path.length - a.path.length);

  const rule = routes.find(r => url.pathname.startsWith(r.path));
  if (!rule) return new Response(`Route not configured. Go to <a href="/admin">/admin</a>`, { headers: {"content-type": "text/html"}, status: 404 });

  let remaining = url.pathname.slice(rule.path.length);
  if (remaining === "" || !remaining.startsWith("/")) remaining = "/" + remaining;

  try {
      const targetBase = new URL(rule.target);
      const newUrl = new URL(remaining.substring(1) + url.search, targetBase);
      const headers = new Headers(req.headers);
      headers.set("Host", targetBase.host);
      
      const pRes = await fetch(new Request(newUrl, {
          method: req.method,
          headers: headers,
          body: req.body,
          redirect: "manual"
      }));
      return new Response(pRes.body, { status: pRes.status, headers: pRes.headers });
  } catch(e) {
      return new Response("Proxy Error: " + e.message, {status: 502});
  }
}

Deno.serve(handleRequest);
