/**
 * Deno Deploy Proxy (Smart Cache Version)
 * 特性：
 * 1. 优先读内存，极大降低 KV 消耗
 * 2. 写入时自动更新内存
 * 3. 60秒自动同步一次 KV (防止多实例数据不一致)
 */

// --- 全局缓存变量 ---
let CACHED_CONFIG = null;
let LAST_FETCH_TIME = 0;
const CACHE_TTL_MS = 60 * 1000; // 缓存有效期 60 秒
// ------------------

// 初始化 KV
let kv;
try { kv = await Deno.openKv(); } catch (e) { console.error("KV启动失败:", e); }

const KEY_CONFIG = ["proxy_config_v1"];
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin";

/**
 * 核心逻辑：获取配置
 * 策略：内存优先 -> 其次读库 -> 写入缓存
 */
async function getConfig() {
    const now = Date.now();
    
    // 1. 如果有缓存，且缓存没过期，直接返回内存数据
    if (CACHED_CONFIG && (now - LAST_FETCH_TIME < CACHE_TTL_MS)) {
        return CACHED_CONFIG;
    }

    // 2. 否则，去读 KV 数据库
    if (!kv) return { routes: [] }; // 防御性编程
    
    try {
        const res = await kv.get(KEY_CONFIG);
        const data = res.value || { routes: [] };
        
        // 3. 更新缓存
        CACHED_CONFIG = data;
        LAST_FETCH_TIME = now;
        console.log("配置已从 KV 更新到内存"); // 只有在日志里看到这句话，才说明消耗了一次 KV 额度
        
        return data;
    } catch (e) {
        console.error("读取 KV 失败:", e);
        return { routes: [] };
    }
}

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>智能缓存反代</title>
    <style>
        body { font-family: sans-serif; background: #f0f9ff; padding: 20px; max-width: 800px; margin: 0 auto; color: #333; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px; color: #0369a1; }
        .tag { background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; }
        .rule-item { display: flex; gap: 10px; margin-bottom: 10px; background: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px;}
        input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        button { cursor: pointer; padding: 8px 16px; border-radius: 4px; border: none; font-weight: bold; }
        .btn-add { background: #10b981; color: white; margin-bottom: 15px; }
        .btn-del { background: #ef4444; color: white; }
        .btn-save { background: #2563eb; color: white; width: 100%; margin-top: 20px; padding: 12px; font-size: 16px;}
        .status { margin-top: 15px; padding: 15px; border-radius: 6px; text-align: center; display: none; }
        .success { background: #dcfce7; color: #166534; }
        .error { background: #fee2e2; color: #991b1b; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🚀 高性能反代配置 <span class="tag">内存加速版</span></h1>
        <p style="font-size:0.9em; color:#666">配置已启用内存缓存。修改保存后立即生效，读取时几乎不消耗数据库额度。</p>
        
        <form id="configForm">
            <div id="rulesList"></div>
            <button type="button" class="btn-add" onclick="addRule()">+ 添加规则</button>
            <div style="margin-top:20px">
                <input type="password" id="password" placeholder="管理密码 (默认 admin)" required style="width: 100%; box-sizing: border-box; padding: 10px;">
            </div>
            <button type="submit" class="btn-save" id="saveBtn">保存配置</button>
        </form>
        <div id="statusMessage" class="status"></div>
    </div>

    <script>
        function addRule(path = '', target = '') {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.innerHTML = \`
                <input type="text" name="path" value="\${path}" placeholder="/openai" required>
                <input type="url" name="target" value="\${target}" placeholder="https://api.openai.com" required>
                <button type="button" class="btn-del" onclick="this.parentElement.remove()">删</button>
            \`;
            document.getElementById('rulesList').appendChild(div);
        }

        fetch('/api/config').then(res => res.json()).then(data => {
            if (data.routes && data.routes.length) data.routes.forEach(r => addRule(r.path, r.target));
            else addRule('/openai', 'https://api.openai.com');
        });

        document.getElementById('configForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('saveBtn');
            const msg = document.getElementById('statusMessage');
            btn.disabled = true; btn.innerText = '保存中...';
            msg.style.display = 'none';

            const routes = Array.from(document.querySelectorAll('.rule-item')).map(item => ({
                path: item.querySelector('[name=path]').value.trim(),
                target: item.querySelector('[name=target]').value.trim()
            }));

            try {
                const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ routes, password: document.getElementById('password').value })
                });
                const data = await res.json();
                msg.style.display = 'block';
                if (res.ok) {
                    msg.className = 'status success';
                    msg.innerText = '✅ 保存成功！内存缓存已更新。';
                } else {
                    msg.className = 'status error';
                    msg.innerText = '❌ 保存失败: ' + (data.error || '未知错误');
                }
            } catch(e) {
                msg.style.display = 'block';
                msg.className = 'status error';
                msg.innerText = '❌ 网络错误: ' + e.message;
            } finally {
                btn.disabled = false; btn.innerText = '保存配置';
            }
        });
    </script>
</body>
</html>
`;

async function handleRequest(req) {
  const url = new URL(req.url);

  // 1. WebUI
  if (url.pathname === "/admin") return new Response(HTML_TEMPLATE, { headers: { "content-type": "text/html; charset=utf-8" } });

  // 2. API (配置读写)
  if (url.pathname === "/api/config") {
    if (req.method === "GET") {
        const config = await getConfig(); // 读缓存
        return Response.json(config);
    }
    if (req.method === "POST") {
        try {
            const body = await req.json();
            if (body.password !== ADMIN_PASSWORD) return Response.json({error:"密码错误"}, {status:401});
            
            // 写入逻辑：
            const newConfig = { routes: body.routes };
            
            // A. 写入数据库 (持久化)
            if (kv) await kv.set(KEY_CONFIG, newConfig);
            
            // B. 写入内存 (立即生效)
            CACHED_CONFIG = newConfig;
            LAST_FETCH_TIME = Date.now(); // 重置计时器
            
            return Response.json({success:true});
        } catch(e) {
            return Response.json({error:e.message}, {status:500});
        }
    }
  }

  // 3. 反代逻辑
  // 核心优化：这里调用 getConfig()，绝大多数时候直接走内存，不查库
  const config = await getConfig();
  const routes = config.routes || [];
  
  // 排序
  routes.sort((a, b) => b.path.length - a.path.length);

  const rule = routes.find(r => url.pathname.startsWith(r.path));
  if (!rule) return new Response(`请访问 <a href="/admin">/admin</a> 配置路由`, { headers: {"content-type": "text/html; charset=utf-8"}, status: 404 });

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
