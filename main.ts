/**
 * Deno Deploy 反代 (增强调试版)
 * 修复了错误提示看不见的问题
 */

// 1. 初始化 KV 数据库
let kv;
try {
  kv = await Deno.openKv();
} catch (e) {
  console.error("KV 启动失败:", e);
}

const KEY_CONFIG = ["proxy_config_v1"];
// 获取密码，默认是 admin
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin";

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>配置面板</title>
    <style>
        body { font-family: sans-serif; background: #f4f4f5; padding: 20px; max-width: 800px; margin: 0 auto; color: #333; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        .rule-item { display: flex; gap: 10px; margin-bottom: 10px; background: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px;}
        input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        button { cursor: pointer; padding: 8px 16px; border-radius: 4px; border: none; font-weight: bold; }
        .btn-add { background: #10b981; color: white; margin-bottom: 15px; }
        .btn-del { background: #ef4444; color: white; }
        .btn-save { background: #2563eb; color: white; width: 100%; margin-top: 20px; padding: 12px; font-size: 16px;}
        .status { margin-top: 15px; padding: 15px; border-radius: 6px; text-align: center; display: none; word-break: break-all;}
        .success { background: #dcfce7; color: #166534; }
        .error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    </style>
</head>
<body>
    <div class="card">
        <h1>⚙️ 路由配置</h1>
        <form id="configForm">
            <div id="rulesList"></div>
            <button type="button" class="btn-add" onclick="addRule()">+ 添加规则</button>
            
            <div style="margin-top: 20px;">
                <label style="font-size: 0.9em; color: #666; display:block; margin-bottom: 5px;">管理密码 (默认为 admin)</label>
                <input type="password" id="password" placeholder="请输入密码" required style="width: 100%; box-sizing: border-box; padding: 10px;">
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
            btn.disabled = true; btn.innerText = '正在保存...';
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
                
                // ⚠️ 关键修改：解析返回的错误信息
                const data = await res.json();
                
                msg.style.display = 'block';
                if (res.ok) {
                    msg.className = 'status success';
                    msg.innerText = '✅ 保存成功！';
                } else {
                    msg.className = 'status error';
                    // 显示具体错误原因
                    msg.innerText = '❌ 失败: ' + (data.error || '未知错误 (Status ' + res.status + ')');
                }
            } catch(e) {
                msg.style.display = 'block';
                msg.className = 'status error';
                msg.innerText = '❌ 网络/代码错误: ' + e.message;
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

  // 2. API
  if (url.pathname === "/api/config") {
    // 检查 KV 是否正常
    if (!kv) {
        return Response.json({ error: "服务器内部错误: KV 未启动 (请检查 deno.json)" }, { status: 500 });
    }

    if (req.method === "GET") {
        const c = await kv.get(KEY_CONFIG);
        return Response.json(c.value || { routes: [] });
    }
    if (req.method === "POST") {
        try {
            const body = await req.json();
            
            // 验证密码
            if (body.password !== ADMIN_PASSWORD) {
                return Response.json({ error: "密码错误！请检查输入。" }, { status: 401 });
            }
            
            // 验证数据
            if (!Array.isArray(body.routes)) {
                return Response.json({ error: "数据格式错误 (routes 不是数组)" }, { status: 400 });
            }

            await kv.set(KEY_CONFIG, { routes: body.routes });
            return Response.json({ success: true });
        } catch (e) {
            return Response.json({ error: "处理请求时出错: " + e.message }, { status: 500 });
        }
    }
  }

  // 3. Proxy Logic
  if (!kv) return new Response("KV Error", { status: 500 });
  
  const config = await kv.get(KEY_CONFIG);
  const routes = config.value?.routes || [];
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
