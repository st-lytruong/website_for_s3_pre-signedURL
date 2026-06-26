/* ── S3 Pre-signed URL Demo ─────────────── */

let dlPresignedUrl = null;
let ulPresignedUrl = null;
let selectedFile   = null;
let MOCK_MODE      = false;

/* ════════════════════════════════════════
   MOCK LAYER
   ════════════════════════════════════════ */
const MOCK = {
  bucket:    'my-private-bucket',
  region:    'ap-southeast-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',

  buildUrl(method, key) {
    const now     = new Date();
    const dateStr = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const dateDay = dateStr.slice(0, 8);
    const scope   = `${dateDay}/${this.region}/s3/aws4_request`;
    const cred    = encodeURIComponent(`${this.accessKey}/${scope}`);
    const sig     = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
    const base    = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    const qs = [
      `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `X-Amz-Credential=${cred}`,
      `X-Amz-Date=${dateStr}`,
      `X-Amz-Expires=300`,
      `X-Amz-SignedHeaders=host`,
      `X-Amz-Signature=${sig}`,
    ].join('&');
    return `${base}?${qs}`;
  },

  downloadResponse(key) {
    return { statusCode: 200, url: this.buildUrl('GET', key), bucket: this.bucket, key, region: this.region, expiresIn: 300, method: 'GET' };
  },

  uploadResponse(key, contentType) {
    return { statusCode: 200, url: this.buildUrl('PUT', key), bucket: this.bucket, key, region: this.region, contentType, expiresIn: 300, method: 'PUT' };
  },

  // What S3 returns when you hit it without a signature
  accessDeniedXml(key) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied</Message>
  <RequestId>EXAMPLE${Math.random().toString(36).slice(2, 10).toUpperCase()}</RequestId>
  <HostId>s3-ap-southeast-1.amazonaws.com</HostId>
  <Key>${key}</Key>
  <BucketName>${this.bucket}</BucketName>
</Error>`,
  },
};

async function mockFetch(endpoint, opts) {
  await delay(600);
  const body     = JSON.parse(opts?.body || '{}');
  const isUpload = endpoint.includes('upload') || body.contentType;
  const data     = isUpload
    ? MOCK.uploadResponse(body.key || 'uploads/demo-file.jpg', body.contentType || 'image/jpeg')
    : MOCK.downloadResponse(body.key || 'images/demo-photo.jpg');
  return { ok: true, status: 200, text: async () => JSON.stringify(data) };
}

function mockXhrUpload(onProgress, onDone) {
  let pct = 0;
  const iv = setInterval(() => {
    pct += Math.random() * 18 + 5;
    if (pct >= 100) { clearInterval(iv); onProgress(100); setTimeout(() => onDone(200), 180); }
    else onProgress(Math.min(Math.round(pct), 99));
  }, 100);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ════════════════════════════════════════
   WITHOUT PRE-SIGNED URL  (the "denied" side)
   ════════════════════════════════════════ */
async function tryWithoutPresign(type) {
  const keyEl  = type === 'download' ? 'dl-key' : 'ul-key';
  const btnId  = type === 'download' ? 'dl-no-btn' : 'ul-no-btn';
  const resId  = type === 'download' ? 'dl-no-result' : 'ul-no-result';
  const rawEl  = type === 'download' ? 'dl-raw-url-text' : 'ul-raw-url-text';

  const key = document.getElementById(keyEl).value.trim() || 'demo/example-file.jpg';
  const bucket = MOCK_MODE ? MOCK.bucket : '<your-bucket>';
  const region = MOCK_MODE ? MOCK.region : '<region>';
  const rawUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  const method = type === 'upload' ? 'PUT' : 'GET';

  // Update URL preview
  document.getElementById(rawEl).textContent = rawUrl;

  const btn = document.getElementById(btnId);
  setLoading(btn, true);

  await delay(MOCK_MODE ? 500 : 800);

  if (MOCK_MODE) {
    // Show the mocked 403 AccessDenied response
    const xmlBody = MOCK.accessDeniedXml(key);
    logResponse(`${method} (direct S3, no signature)`, rawUrl, {}, 403, xmlBody);
    renderCompareResult(resId, {
      status: 403,
      label:  '403 Access Denied',
      type:   'denied',
      body:   xmlBody,
      explain: `S3 bucket is <strong>private</strong>. Without a valid signature, all ${method} requests are rejected with <code>AccessDenied</code>.`,
    });
  } else {
    // Real mode: actually attempt the request (will fail with CORS/network, which is also instructive)
    try {
      const res = await fetch(rawUrl, { method, mode: 'no-cors' });
      // no-cors gives opaque response — we can't read the body, but it demonstrates the attempt
      logResponse(`${method} (direct S3, no signature)`, rawUrl, {}, '—', '(opaque response — CORS blocked by browser)');
      renderCompareResult(resId, {
        status: '—',
        label:  'CORS Blocked / 403',
        type:   'denied',
        body:   '(Browser CORS policy blocked the response body)\nS3 would return HTTP 403 AccessDenied.',
        explain: `S3 bucket is <strong>private</strong>. Direct requests without a pre-signed URL are blocked — either by S3 (403 AccessDenied) or by CORS policy.`,
      });
    } catch (e) {
      logResponse(`${method} (direct S3, no signature)`, rawUrl, {}, 'ERR', e.message);
      renderCompareResult(resId, {
        status: 'ERR',
        label:  'Request Failed',
        type:   'denied',
        body:   e.message,
        explain: `S3 bucket is <strong>private</strong>. The request was rejected before reaching S3.`,
      });
    }
  }

  setLoading(btn, false);
}

function renderCompareResult(id, { status, label, type, body, explain }) {
  const el = document.getElementById(id);
  const isDenied = type === 'denied';
  el.innerHTML = `
    <div class="cmp-status ${isDenied ? 'cmp-denied' : 'cmp-ok'}">
      <span class="cmp-code">${status}</span>
      <span class="cmp-label">${label}</span>
    </div>
    <div class="cmp-body">${body}</div>
    <div class="cmp-explain">${explain}</div>
  `;
  el.style.display = 'flex';
}

/* ════════════════════════════════════════
   MOCK TOGGLE
   ════════════════════════════════════════ */
function toggleMock(on) {
  MOCK_MODE = on;
  document.getElementById('mock-banner').style.display = on ? 'flex' : 'none';
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.style.background  = on ? '#f59e0b' : '#22c55e';
  dot.style.boxShadow   = on ? '0 0 0 2px #fde68a' : '0 0 0 2px #bbf7d0';
  label.textContent     = on ? 'Mock Mode — no real AWS' : 'AWS Lambda · API Gateway · S3';

  if (on) {
    if (!document.getElementById('dl-api').value)
      document.getElementById('dl-api').value = 'https://abc123def.execute-api.ap-southeast-1.amazonaws.com/prod/presign/download';
    if (!document.getElementById('dl-key').value)
      document.getElementById('dl-key').value = 'images/demo-photo.jpg';
    if (!document.getElementById('ul-api').value)
      document.getElementById('ul-api').value = 'https://abc123def.execute-api.ap-southeast-1.amazonaws.com/prod/presign/upload';
    if (!document.getElementById('ul-key').value)
      document.getElementById('ul-key').value = 'uploads/my-document.pdf';
    document.getElementById('ul-ct').value = 'application/pdf';
  }
}

/* ════════════════════════════════════════
   TAB SWITCH
   ════════════════════════════════════════ */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('panel-download').classList.toggle('hidden', tab !== 'download');
  document.getElementById('panel-upload').classList.toggle('hidden', tab !== 'upload');
}

/* ════════════════════════════════════════
   DOWNLOAD — WITH pre-signed URL
   ════════════════════════════════════════ */
async function doDownload() {
  const api = document.getElementById('dl-api').value.trim().replace(/\/$/, '');
  const key = document.getElementById('dl-key').value.trim();

  clearErr('dl-error');

  if (!api) return showErr('dl-error', 'Paste your API Gateway URL above.');
  if (!key) return showErr('dl-error', 'Enter the S3 Object Key.');

  const btn = document.getElementById('dl-btn');
  setLoading(btn, true);

  try {
    const reqBody = { key, expiresIn: 300 };
    const fetchFn = MOCK_MODE ? mockFetch : fetch;
    const res     = await fetchFn(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    logResponse('POST (API Gateway → Lambda)', api, reqBody, res.status, data);

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const url = extractUrl(data);
    if (!url) throw new Error('No URL in response. Check Lambda output format.');

    dlPresignedUrl = url;
    document.getElementById('dl-url-box').value = url;
    document.getElementById('dl-signed-url-preview').style.display = 'block';

    renderCompareResult('dl-yes-result', {
      status:  '200',
      label:   '200 OK — URL Generated',
      type:    'ok',
      body:    `Lambda returned a pre-signed URL valid for 5 minutes.\nSigned with: AWS4-HMAC-SHA256`,
      explain: `API Gateway invoked Lambda, which used the <strong>AWS SDK</strong> to generate a time-limited signed URL. The client can now use this URL directly.`,
    });

    renderMeta('dl', url, data, key, 'GET');
    document.getElementById('dl-meta').style.display = 'grid';
    document.getElementById('dl-download-actions').style.display = 'flex';

  } catch (e) {
    showErr('dl-error', e.message);
  } finally {
    setLoading(btn, false);
  }
}

function triggerDownload() {
  if (!dlPresignedUrl) return;
  if (MOCK_MODE) {
    const key     = document.getElementById('dl-key').value || 'demo-file';
    const content = `[MOCK] Demo download file\nKey: ${key}\nTimestamp: ${new Date().toISOString()}\n\nThis file was "downloaded" using a mock pre-signed URL.\nIn production, S3 would serve the actual object.`;
    const blob    = new Blob([content], { type: 'text/plain' });
    const a       = document.createElement('a');
    a.href        = URL.createObjectURL(blob);
    a.download    = key.split('/').pop() || 'demo-file.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Mock file downloaded ✓');
    return;
  }
  const a = document.createElement('a');
  a.href  = dlPresignedUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ════════════════════════════════════════
   UPLOAD — WITH pre-signed URL
   ════════════════════════════════════════ */
async function doUpload() {
  const api = document.getElementById('ul-api').value.trim().replace(/\/$/, '');
  const key = document.getElementById('ul-key').value.trim();
  const ct  = document.getElementById('ul-ct').value;

  clearErr('ul-error');

  if (!api) return showErr('ul-error', 'Paste your API Gateway URL above.');
  if (!key) return showErr('ul-error', 'Enter the S3 Object Key (destination path).');

  const btn = document.getElementById('ul-btn');
  setLoading(btn, true);

  try {
    const reqBody = { key, contentType: ct, expiresIn: 300 };
    const fetchFn = MOCK_MODE ? mockFetch : fetch;
    const res     = await fetchFn(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    logResponse('POST (API Gateway → Lambda)', api, reqBody, res.status, data);

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const url = extractUrl(data);
    if (!url) throw new Error('No URL in response. Check Lambda output format.');

    ulPresignedUrl = url;
    document.getElementById('ul-url-box').value = url;
    document.getElementById('ul-signed-url-preview').style.display = 'block';
    document.getElementById('ul-ct-hint').textContent = ct;

    renderCompareResult('ul-yes-result', {
      status:  '200',
      label:   '200 OK — URL Generated',
      type:    'ok',
      body:    `Lambda returned a pre-signed PUT URL valid for 5 minutes.\nContent-Type locked to: ${ct}`,
      explain: `The client can now <strong>PUT</strong> directly to S3 using this URL — no AWS credentials needed on the client side.`,
    });

    renderMeta('ul', url, data, key, 'PUT');
    document.getElementById('ul-meta').style.display = 'grid';
    document.getElementById('ul-upload-area').style.display = 'block';

    // Reset file input
    selectedFile = null;
    document.getElementById('ul-file').value = '';
    document.getElementById('drop-text').textContent = 'Click or drag file here';
    document.getElementById('ul-send-btn').disabled = true;
    document.getElementById('ul-status').textContent = '';
    document.getElementById('ul-status').className = '';
    hide('progress-row');

  } catch (e) {
    showErr('ul-error', e.message);
  } finally {
    setLoading(btn, false);
  }
}

/* ════════════════════════════════════════
   RENDER META GRID
   ════════════════════════════════════════ */
function renderMeta(prefix, url, data, key, method) {
  const parsed  = parsePresignedUrl(url);
  const expSecs = parsed.expires ? parseInt(parsed.expires) : (data.expiresIn || 300);
  const expMin  = Math.round(expSecs / 60);

  const items = [
    { k: 'HTTP Method', v: method,                                          c: method === 'GET' ? 'blue' : 'green' },
    { k: 'Object Key',  v: key,                                             c: 'mono' },
    { k: 'Bucket',      v: data.bucket || parsed.bucket || extractBucket(url), c: 'mono' },
    { k: 'Region',      v: data.region || parsed.region || '—',             c: '' },
    { k: 'Algorithm',   v: parsed.algorithm || 'AWS4-HMAC-SHA256',          c: 'mono' },
    { k: 'Expires In',  v: `${expSecs}s (${expMin} min)`,                   c: 'orange' },
    { k: 'Credential',  v: parsed.credential ? truncate(parsed.credential, 32) : '—', c: 'mono' },
    { k: 'Signed At',   v: parsed.date ? formatDate(parsed.date) : new Date().toLocaleTimeString(), c: '' },
  ];

  document.getElementById(`${prefix}-meta`).innerHTML = items.map(m => `
    <div class="meta-item">
      <div class="meta-key">${m.k}</div>
      <div class="meta-val ${m.c}">${m.v}</div>
    </div>`).join('');
}

/* ════════════════════════════════════════
   DIRECT UPLOAD TO S3
   ════════════════════════════════════════ */
function onFileChange(e) {
  const f = e.target.files[0];
  if (!f) return;
  selectedFile = f;
  document.getElementById('drop-text').textContent = `${f.name}  (${fmtBytes(f.size)})`;
  document.getElementById('ul-send-btn').disabled = false;
}

function initDrop() {
  const zone = document.getElementById('drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    selectedFile = f;
    document.getElementById('drop-text').textContent = `${f.name}  (${fmtBytes(f.size)})`;
    document.getElementById('ul-send-btn').disabled = false;
  });
}

async function sendUpload() {
  if (!ulPresignedUrl) return;
  if (MOCK_MODE && !selectedFile) {
    selectedFile = new File(['[MOCK CONTENT — demo file]'], 'mock-file.txt', { type: 'text/plain' });
    document.getElementById('drop-text').textContent = 'mock-file.txt  (26 B)';
  }
  if (!selectedFile) return;

  const ct     = document.getElementById('ul-ct').value;
  const btn    = document.getElementById('ul-send-btn');
  const status = document.getElementById('ul-status');

  btn.disabled       = true;
  status.textContent = '';
  status.className   = '';
  show('progress-row');
  setBar(0);

  try {
    if (MOCK_MODE) {
      await new Promise(resolve => mockXhrUpload(pct => setBar(pct), () => resolve()));
    } else {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', ulPresignedUrl);
        xhr.setRequestHeader('Content-Type', ct);
        xhr.upload.onprogress = ev => {
          if (ev.lengthComputable) setBar(Math.round(ev.loaded / ev.total * 100));
        };
        xhr.onload  = () => xhr.status < 300 ? resolve() : reject(new Error(`S3 returned HTTP ${xhr.status}`));
        xhr.onerror = ()  => reject(new Error('Network error'));
        xhr.send(selectedFile);
      });
    }

    setBar(100);
    status.innerHTML  = '<span style="color:#16a34a;font-weight:700">✓ Upload successful — file is now in S3</span>';
    logResponse(
      'PUT (direct to S3 using pre-signed URL)',
      ulPresignedUrl.split('?')[0] + '?[signature]',
      { file: selectedFile.name, size: fmtBytes(selectedFile.size), contentType: ct },
      200,
      { message: MOCK_MODE ? '[MOCK] 200 OK — S3 accepted the upload' : '200 OK' }
    );

  } catch (e) {
    status.innerHTML = `<span style="color:#dc2626;font-weight:700">✗ ${e.message}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function setBar(pct) {
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
}

/* ════════════════════════════════════════
   COPY
   ════════════════════════════════════════ */
function copyText(id) {
  const text = document.getElementById(id)?.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

/* ════════════════════════════════════════
   LOG
   ════════════════════════════════════════ */
function logResponse(method, url, reqBody, status, resBody) {
  const ok  = typeof status === 'number' && status >= 200 && status < 300;
  const tag = MOCK_MODE ? ' [MOCK]' : '';
  const statusStr = typeof status === 'number' ? `HTTP ${status} ${ok ? '✓ OK' : '✗ ERROR'}` : status;
  const bodyStr   = typeof resBody === 'string' ? resBody : JSON.stringify(resBody, null, 2);
  const out = [
    `[${new Date().toLocaleTimeString()}]${tag}  ${method}  →  ${statusStr}`,
    `Endpoint : ${url}`,
    `Request  : ${JSON.stringify(reqBody)}`,
    `Response :\n${bodyStr}`,
    '─'.repeat(64),
  ].join('\n');

  const pre  = document.getElementById('log-body');
  const prev = pre.textContent.startsWith('—') ? '' : '\n\n' + pre.textContent;
  pre.textContent = out + prev;
}

function clearLog() {
  document.getElementById('log-body').textContent = '— no requests yet —';
}

/* ════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════ */
function extractUrl(data) {
  return data?.url || data?.presignedUrl || data?.uploadUrl || data?.downloadUrl || data?.signedUrl || null;
}

function parsePresignedUrl(url) {
  try {
    const u      = new URL(url);
    const p      = Object.fromEntries(u.searchParams);
    let bucket = '', region = '';
    const host = u.hostname;
    const m1   = host.match(/^(.+?)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    const m2   = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    if (m1) { bucket = m1[1]; region = m1[2]; }
    else if (m2) { region = m2[1]; bucket = u.pathname.split('/')[1]; }
    return {
      bucket,
      region,
      credential: p['X-Amz-Credential'] || p['x-amz-credential'] || '',
      algorithm:  p['X-Amz-Algorithm']  || p['x-amz-algorithm']  || '',
      date:       p['X-Amz-Date']        || p['x-amz-date']        || '',
      expires:    p['X-Amz-Expires']     || p['x-amz-expires']     || '',
    };
  } catch { return {}; }
}

function extractBucket(url) {
  try { const m = new URL(url).hostname.match(/^(.+?)\.s3/); return m ? m[1] : '—'; }
  catch { return '—'; }
}

function formatDate(d) {
  try { return d.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3 $4:$5:$6 UTC'); }
  catch { return d; }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function fmtBytes(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function show(id)  { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function hide(id)  { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function showErr(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.style.display = 'block'; }
function clearErr(id)     { const el = document.getElementById(id); el.textContent = ''; el.style.display = 'none'; }

function setLoading(btn, on) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ── Init ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const dlSaved = localStorage.getItem('dl-api');
  const ulSaved = localStorage.getItem('ul-api');
  if (dlSaved) document.getElementById('dl-api').value = dlSaved;
  if (ulSaved) document.getElementById('ul-api').value = ulSaved;
  document.getElementById('dl-api').addEventListener('input', e => localStorage.setItem('dl-api', e.target.value));
  document.getElementById('ul-api').addEventListener('input', e => localStorage.setItem('ul-api', e.target.value));
  initDrop();
});
