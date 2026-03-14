import prisma from "../db.server";

/**
 * App Proxy download endpoint.
 * URL (via proxy): https://{store}.myshopify.com/apps/pendora/api/download/:fileId
 *
 * Returns a tiny HTML page that uses JS fetch + blob URL to force a true file
 * download. This means:
 *   - Only the small HTML page passes through the tunnel (fast)
 *   - The actual file bytes go Browser → Shopify CDN directly (no tunnel bottleneck)
 *   - Content-Disposition: attachment is enforced via the blob + <a download> trick
 */
export const loader = async ({ request, params }) => {
  const { fileId } = params;
  if (!fileId) return new Response("Missing file ID.", { status: 400 });

  let file;
  try {
    file = await prisma.productFile.findUnique({ where: { id: fileId } });
  } catch {
    return new Response("Database error.", { status: 500 });
  }

  if (!file || !file.fileUrl) {
    return new Response("File not found.", { status: 404 });
  }

  const cdnUrl  = JSON.stringify(file.fileUrl);
  const filename = JSON.stringify(file.displayName || file.fileName || "download");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Downloading your file…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#f4f6f8;display:flex;align-items:center;
         justify-content:center;min-height:100vh;padding:20px}
    .card{background:#fff;border-radius:14px;padding:40px 36px;
          text-align:center;max-width:420px;width:100%;
          box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-size:20px;font-weight:700;color:#111;margin-bottom:8px}
    p{font-size:14px;color:#666;line-height:1.6;margin-bottom:20px}
    .btn{display:inline-block;padding:11px 28px;background:#111;color:#fff;
         border-radius:8px;text-decoration:none;font-size:14px;font-weight:600}
    .spinner{display:inline-block;width:18px;height:18px;border:2px solid #ccc;
             border-top-color:#111;border-radius:50%;animation:spin .7s linear infinite;
             vertical-align:middle;margin-right:8px}
    @keyframes spin{to{transform:rotate(360deg)}}
    #fallback{display:none;margin-top:16px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⬇️</div>
    <h1 id="title">Preparing your download…</h1>
    <p id="msg"><span class="spinner"></span>Fetching your file, please wait.</p>
    <div id="fallback">
      <p>Download didn't start automatically?</p>
      <a class="btn" href=${cdnUrl} download=${filename}>Download manually</a>
    </div>
  </div>
  <script>
    (async () => {
      const cdnUrl  = ${cdnUrl};
      const filename = ${filename};
      try {
        const res = await fetch(cdnUrl);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.getElementById('title').textContent = 'Download started!';
        document.getElementById('msg').textContent =
          'Your file is downloading. You can close this tab.';
      } catch {
        // Fallback: direct link (may open in browser for PDFs/images)
        document.getElementById('title').textContent = 'Ready to download';
        document.getElementById('msg').textContent =
          'Click the button below to download your file.';
        document.getElementById('fallback').style.display = 'block';
      }
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
