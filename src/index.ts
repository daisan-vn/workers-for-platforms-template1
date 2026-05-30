export interface Env {
  DB: D1Database;
  dispatcher: DispatchNamespace;
  AI: Ai;
  ACCOUNT_ID: string;
  DISPATCH_NAMESPACE_API_TOKEN: string;
  // Service binding to the VibeSDK worker (vibesdk-production). Sandbox preview
  // subdomains are proxied to it because it owns the sandbox containers.
  VIBESDK?: Fetcher;
}

// Sandbox preview subdomains look like: <port:4-5 digits>-<sandboxId>-<token:16 chars>
// e.g. 3000-abc123-0123456789abcdef.daisan.ai
const PREVIEW_SUBDOMAIN_RE = /^\d{4,5}-.+-[a-z0-9_-]{16}$/;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function notFoundResponse(host: string, slug: string): Response {
  const h = esc(host);
  const s = esc(slug);
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>App not found · Daisan AI</title>
<style>
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{background:#0b0b12;color:#e7e7ee;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    display:flex;align-items:center;justify-content:center;padding:24px;overflow:hidden}
  .glow{position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);width:140vw;max-width:1400px;height:70vh;
    filter:blur(130px);opacity:.30;pointer-events:none;
    background:radial-gradient(closest-side,rgba(255,61,0,.5),rgba(217,70,239,.28) 45%,rgba(56,118,255,.22) 70%,transparent)}
  .card{position:relative;width:100%;max-width:520px;background:rgba(20,20,30,.7);border:1px solid rgba(255,255,255,.08);
    border-radius:16px;padding:32px;backdrop-filter:blur(8px)}
  .badge{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#ff6a3d;
    background:rgba(255,61,0,.1);border:1px solid rgba(255,61,0,.25);padding:5px 10px;border-radius:999px}
  h1{font-size:22px;margin:18px 0 6px;letter-spacing:-.3px}
  p.sub{color:#a0a0ad;margin:0 0 20px}
  .kv{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;margin-bottom:18px}
  .kv div{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:3px 0}
  .kv span{color:#8a8a96} .kv code{color:#d7d7e0;font-family:ui-monospace,Consolas,monospace;word-break:break-all;text-align:right}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#8a8a96;margin:0 0 8px}
  ul{margin:0 0 22px;padding-left:18px;color:#b6b6c2;font-size:13px} li{margin:4px 0}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  a.btn{flex:1;min-width:150px;text-align:center;text-decoration:none;font-size:14px;font-weight:500;padding:10px 14px;border-radius:10px}
  a.primary{background:#ff3d00;color:#fff} a.ghost{background:transparent;color:#cfcfd8;border:1px solid rgba(255,255,255,.12)}
  .ft{margin-top:18px;font-size:12px;color:#6f6f7a;text-align:center}
</style></head>
<body>
  <div class="glow"></div>
  <div class="card">
    <span class="badge">⚠ Not deployed</span>
    <h1>App not found or not deployed yet</h1>
    <p class="sub">We couldn't find a deployed app for this address.</p>
    <div class="kv">
      <div><span>Hostname</span><code>${h}</code></div>
      <div><span>App slug</span><code>${s}</code></div>
    </div>
    <h2>Possible causes</h2>
    <ul>
      <li>The app hasn't finished deploying yet</li>
      <li>The deployment failed during build</li>
      <li>This subdomain isn't mapped to an app</li>
      <li>The URL is incorrect</li>
    </ul>
    <div class="row">
      <a class="btn primary" href="https://daisan.ai/">Open Daisan AI</a>
      <a class="btn ghost" href="https://daisan.ai/apps">Your apps</a>
    </div>
    <div class="ft">Daisan AI · daisan.ai</div>
  </div>
</body></html>`;
  return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname;
    
    // Nếu là subdomain (khác daisan.ai), route đến user worker
    if (host !== 'daisan.ai' && host.endsWith('.daisan.ai')) {
      const workerName = host.split('.')[0];

      // Sandbox live previews are not deployed workers in the dispatch namespace —
      // they are proxied by the VibeSDK worker (proxyToSandbox). Forward them.
      if (PREVIEW_SUBDOMAIN_RE.test(workerName) && env.VIBESDK) {
        return env.VIBESDK.fetch(request);
      }

      try {
        const userWorker = env.dispatcher.get(workerName);
        return await userWorker.fetch(request);
      } catch (e) {
        return notFoundResponse(host, workerName);
      }
    }

    // API Routes
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      return handleGenerate(request, env);
    }
    if (url.pathname === '/api/deploy' && request.method === 'POST') {
      return handleDeploy(request, env);
    }
    if (url.pathname === '/api/projects') {
      return handleListProjects(env);
    }

    // Landing Page
    return new Response(landingPageHTML(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
};

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const { prompt } = await request.json() as { prompt: string };
  
  const systemPrompt = `You are an expert web developer. Create a complete, single-file HTML app based on the user's description. 
The app must be beautiful, responsive, and use Tailwind CSS via CDN.
Return ONLY the HTML code, no explanations, no markdown code blocks.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages });
  const generatedCode = (response as any).response || '';

  // Extract HTML from response
  let html = generatedCode;
  if (html.includes('```html')) {
    html = html.split('```html')[1].split('```')[0];
  } else if (html.includes('```')) {
    html = html.split('```')[1].split('```')[0];
  }

  return Response.json({ 
    success: true, 
    html: html.trim(),
    preview: html.substring(0, 200) + '...'
  });
}

async function handleDeploy(request: Request, env: Env): Promise<Response> {
  const { name, html, subdomain } = await request.json() as { 
    name: string; 
    html: string; 
    subdomain: string;
  };

  // Create worker script from HTML
  const workerCode = `
export default {
  async fetch(request, env, ctx) {
    return new Response(\`${html.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
};`;

  // Deploy to dispatch namespace via API
  const deployRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/workers/dispatch/namespaces/workers-for-platforms-template/scripts/${subdomain}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.DISPATCH_NAMESPACE_API_TOKEN}`,
        'Content-Type': 'application/javascript'
      },
      body: workerCode
    }
  );

  if (!deployRes.ok) {
    const error = await deployRes.text();
    return Response.json({ success: false, error }, { status: 500 });
  }

  // Save to D1
  await env.DB.prepare(
    `INSERT INTO projects (name, subdomain, script_content) VALUES (?, ?, ?)`
  ).bind(name, subdomain, workerCode).run();

  return Response.json({
    success: true,
    url: `https://${subdomain}.daisan.ai`,
    message: `App deployed successfully!`
  });
}

async function handleListProjects(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, subdomain, created_on FROM projects ORDER BY created_on DESC'
  ).all();
  
  return Response.json({ projects: results });
}

function landingPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daisan AI - Build Apps with Prompts</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif}</style>
</head>
<body class="bg-slate-950 text-white min-h-screen">
  <!-- Hero -->
  <div class="max-w-5xl mx-auto px-6 pt-20 pb-16">
    <div class="text-center mb-16">
      <h1 class="text-5xl md:text-7xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-6">
        Build Apps with AI
      </h1>
      <p class="text-xl text-slate-400 max-w-2xl mx-auto">
        Describe what you want. Our AI builds it. Deploy instantly to your own subdomain.
      </p>
    </div>

    <!-- Prompt Input -->
    <div class="max-w-3xl mx-auto mb-12">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-2">
        <textarea 
          id="prompt" 
          placeholder="Describe your app... e.g., 'A beautiful todo list app with dark mode and drag-drop'"
          class="w-full bg-transparent text-white p-4 resize-none outline-none text-lg h-32 placeholder-slate-500"
        ></textarea>
        <div class="flex justify-between items-center px-4 pb-2">
          <span class="text-sm text-slate-500">Powered by Cloudflare AI</span>
          <button 
            onclick="generateApp()"
            id="generateBtn"
            class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2"
          >
            <span>Generate App</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Preview Area -->
    <div id="previewArea" class="hidden max-w-4xl mx-auto mb-12">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 class="font-semibold text-lg">Preview</h3>
          <div class="flex gap-3">
            <input 
              type="text" 
              id="subdomain" 
              placeholder="your-app-name"
              class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            >
            <button 
              onclick="deployApp()"
              id="deployBtn"
              class="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
            >
              Deploy to daisan.ai
            </button>
          </div>
        </div>
        <div class="p-6">
          <iframe id="previewFrame" class="w-full h-96 bg-white rounded-lg"></iframe>
        </div>
        <div id="deployResult" class="px-6 pb-4 hidden">
          <div class="bg-green-900/30 border border-green-700/50 rounded-lg p-4">
            <p class="text-green-400 font-medium">App deployed successfully!</p>
            <a id="appUrl" href="#" target="_blank" class="text-blue-400 hover:underline mt-1 inline-block"></a>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Projects -->
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-bold mb-6">Recent Projects</h2>
      <div id="projectsList" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div class="text-slate-500 text-center py-12">Loading...</div>
      </div>
    </div>
  </div>

  <script>
    let currentHtml = '';

    async function generateApp() {
      const prompt = document.getElementById('prompt').value;
      const btn = document.getElementById('generateBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="animate-spin">⚡</span> Generating...';

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        const data = await res.json();
        
        if (data.success) {
          currentHtml = data.html;
          document.getElementById('previewArea').classList.remove('hidden');
          document.getElementById('previewFrame').srcdoc = currentHtml;
          document.getElementById('subdomain').value = prompt.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Generate App</span><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
      }
    }

    async function deployApp() {
      const subdomain = document.getElementById('subdomain').value;
      const btn = document.getElementById('deployBtn');
      btn.disabled = true;
      btn.textContent = 'Deploying...';

      try {
        const res = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            name: subdomain,
            html: currentHtml,
            subdomain 
          })
        });
        const data = await res.json();
        
        if (data.success) {
          document.getElementById('deployResult').classList.remove('hidden');
          document.getElementById('appUrl').href = data.url;
          document.getElementById('appUrl').textContent = data.url;
          loadProjects();
        } else {
          alert('Deploy failed: ' + data.error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Deploy to daisan.ai';
      }
    }

    async function loadProjects() {
      try {
        const res = await fetch('/api/projects');
        const data = await res.json();
        const container = document.getElementById('projectsList');
        
        if (!data.projects?.length) {
          container.innerHTML = '<div class="text-slate-500 text-center py-12 col-span-full">No projects yet. Create your first app above!</div>';
          return;
        }

        container.innerHTML = data.projects.map(p => \`
          <a href="https://\${p.subdomain}.daisan.ai" target="_blank" 
             class="block bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-blue-500/50 transition-all group">
            <h3 class="font-semibold text-lg mb-2 group-hover:text-blue-400 transition-colors">\${p.name}</h3>
            <p class="text-sm text-slate-500 mb-3">\${p.subdomain}.daisan.ai</p>
            <span class="text-xs text-slate-600">\${new Date(p.created_on).toLocaleDateString()}</span>
          </a>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    loadProjects();
  </script>
</body>
</html>`;
}
