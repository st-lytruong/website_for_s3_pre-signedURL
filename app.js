/* ============================================
   S3 Pre-signed URL Lab - JavaScript
   ============================================ */

// ── State ──────────────────────────────────────
let selectedFile = null;
let currentUploadUrl = null;
let currentDownloadUrl = null;

// ── Config ─────────────────────────────────────
function loadConfig() {
  const url = localStorage.getItem('apiBaseUrl') || '';
  const bucket = localStorage.getItem('bucketName') || '';
  document.getElementById('apiBaseUrl').value = url;
  document.getElementById('bucketName').value = bucket;
  return { apiBaseUrl: url.replace(/\/$/, ''), bucketName: bucket };
}

function saveConfig() {
  const url = document.getElementById('apiBaseUrl').value.trim().replace(/\/$/, '');
  const bucket = document.getElementById('bucketName').value.trim();
  localStorage.setItem('apiBaseUrl', url);
  localStorage.setItem('bucketName', bucket);
  const status = document.getElementById('configStatus');
  status.textContent = '✅ Saved!';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

function toggleConfig() {
  const panel = document.getElementById('configPanel');
  panel.classList.toggle('hidden');
}

// ── Expiry label ───────────────────────────────
function updateExpiryLabel(type) {
  const val = parseInt(document.getElementById(`${type}Expiry`).value);
  const mins = Math.floor(val / 60);
  const secs = val % 60;
  let label = `${val}s`;
  if (mins > 0) label += ` (${mins}m${secs > 0 ? secs + 's' : ''})`;
  document.getElementById(`${type}ExpiryLabel`).textContent = label;
}

// ── Generate Download URL ──────────────────────
async function generateDownloadUrl() {
  const { apiBaseUrl } = loadConfig();
  const key = document.getElementById('downloadKey').value.trim();
  const expiry = document.getElementById('downloadExpiry').value;

  hideEl('downloadResult');
  hideEl('downloadError');

  if (!apiBaseUrl) return showError('downloadError', '⚠️ Please set your API Gateway URL in Configuration.');
  if (!key) return showError('downloadError', '⚠️ Please enter an S3 Object Key.');

  const btn = document.getElementById('downloadBtn');
  setLoading(btn, true);

  try {
    const endpoint = `${apiBaseUrl}/presign/download`;
    const body = { key, expiresIn: parseInt(expiry) };

    addLog('POST', endpoint, body);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    updateLog(res.status, data);

    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    const presignedUrl = data.url || data.presignedUrl || data.downloadUrl || data.signedUrl;
    if (!presignedUrl) throw new Error('No URL found in response. Check Lambda response format.');

    currentDownloadUrl = presignedUrl;
    document.getElementById('downloadUrl').value = presignedUrl;

    const expiryVal = parseInt(expiry);
    document.getElementById('downloadExpiryBadge').textContent = `Expires in ${expiryVal}s`;
    showEl('downloadResult');

  } catch (err) {
    showError('downloadError', `❌ Error: ${err.message}`);
  } finally {
    setLoading(btn, false);
  }
}

// ── Generate Upload URL ────────────────────────
async function generateUploadUrl() {
  const { apiBaseUrl } = loadConfig();
  const key = document.getElementById('uploadKey').value.trim();
  const contentType = document.getElementById('uploadContentType').value;
  const expiry = document.getElementById('uploadExpiry').value;

  hideEl('uploadResult');
  hideEl('uploadError');

  if (!apiBaseUrl) return showError('uploadError', '⚠️ Please set your API Gateway URL in Configuration.');
  if (!key) return showError('uploadError', '⚠️ Please enter an S3 Object Key (destination path).');

  const btn = document.getElementById('uploadBtn');
  setLoading(btn, true);

  try {
    const endpoint = `${apiBaseUrl}/presign/upload`;
    const body = { key, contentType, expiresIn: parseInt(expiry) };

    addLog('POST', endpoint, body);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    updateLog(res.status, data);

    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    const presignedUrl = data.url || data.presignedUrl || data.uploadUrl || data.signedUrl;
    if (!presignedUrl) throw new Error('No URL found in response. Check Lambda response format.');

    currentUploadUrl = presignedUrl;
    document.getElementById('uploadUrl').value = presignedUrl;

    const expiryVal = parseInt(expiry);
    document.getElementById('uploadExpiryBadge').textContent = `Expires in ${expiryVal}s`;
    document.getElementById('postmanContentType').textContent = contentType;

    // Reset file selection
    selectedFile = null;
    document.getElementById('selectedFileName').textContent = '';
    document.getElementById('uploadFileBtn').disabled = true;
    document.getElementById('fileInput').value = '';
    hideEl('progressWrap');
    document.getElementById('uploadFileStatus').textContent = '';

    showEl('uploadResult');

  } catch (err) {
    showError('uploadError', `❌ Error: ${err.message}`);
  } finally {
    setLoading(btn, false);
  }
}

// ── File Selection ─────────────────────────────
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  selectedFile = file;
  document.getElementById('selectedFileName').textContent = `📄 ${file.name} (${formatBytes(file.size)})`;
  document.getElementById('uploadFileBtn').disabled = false;
}

function onDragOver(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.add('dragover');
}
function onDragLeave(e) {
  document.getElementById('dropZone').classList.remove('dragover');
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  selectedFile = file;
  document.getElementById('selectedFileName').textContent = `📄 ${file.name} (${formatBytes(file.size)})`;
  document.getElementById('uploadFileBtn').disabled = false;
}

// ── Upload directly to S3 via pre-signed URL ───
async function uploadFileDirect() {
  if (!selectedFile || !currentUploadUrl) return;

  const contentType = document.getElementById('uploadContentType').value;
  const btn = document.getElementById('uploadFileBtn');
  const statusEl = document.getElementById('uploadFileStatus');

  btn.disabled = true;
  statusEl.textContent = '';
  showEl('progressWrap');
  setProgress(0);

  try {
    await uploadWithProgress(currentUploadUrl, selectedFile, contentType, (pct) => {
      setProgress(pct);
    });

    setProgress(100);
    statusEl.innerHTML = `<span style="color:var(--green)">✅ Upload successful! File is now in S3.</span>`;
    addLog('PUT (direct to S3)', currentUploadUrl.split('?')[0] + '?[signature]', { file: selectedFile.name, size: formatBytes(selectedFile.size) });
    updateLog(200, { message: 'Upload to S3 successful', file: selectedFile.name });

  } catch (err) {
    statusEl.innerHTML = `<span style="color:var(--red)">❌ Upload failed: ${err.message}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function uploadWithProgress(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 returned HTTP ${xhr.status}: ${xhr.responseText || 'No response body'}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

function setProgress(pct) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = pct + '%';
}

// ── Download helpers ───────────────────────────
function downloadFile() {
  if (!currentDownloadUrl) return;
  const a = document.createElement('a');
  a.href = currentDownloadUrl;
  a.download = '';
  a.click();
}

function openUrl(id) {
  const url = document.getElementById(id).value;
  if (url) window.open(url, '_blank');
}

function copyUrl(id) {
  const url = document.getElementById(id).value;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    showToast('📋 Copied to clipboard!');
  });
}

// ── Toast ──────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:#1e2235; border:1px solid #6366f1;
    color:#e2e8f0; padding:10px 18px; border-radius:8px;
    font-size:13px; font-weight:600;
    animation: fadeIn .2s ease;
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ── API Log ────────────────────────────────────
let _lastLogEntry = null;

function addLog(method, url, body) {
  const container = document.getElementById('logContainer');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const methodClass = method.startsWith('GET') ? 'log-get' : 'log-post';
  const now = new Date().toLocaleTimeString();

  entry.innerHTML = `
    <div>
      <span class="log-time">${now}</span>
      <span class="log-method ${methodClass}">${method}</span>
      <span class="log-url">${url}</span>
    </div>
    <div class="log-body">${JSON.stringify(body, null, 2)}</div>
    <div class="log-status" id="logStatus_${Date.now()}">⏳ Waiting for response...</div>
  `;

  container.prepend(entry);
  _lastLogEntry = entry;
}

function updateLog(status, data) {
  if (!_lastLogEntry) return;
  const statusEl = _lastLogEntry.querySelector('[id^="logStatus_"]');
  if (!statusEl) return;

  const ok = status >= 200 && status < 300;
  statusEl.className = `log-status ${ok ? 'log-ok' : 'log-err'}`;
  statusEl.textContent = `${ok ? '✅' : '❌'} HTTP ${status}`;

  // Append response body
  const bodyEl = document.createElement('div');
  bodyEl.className = 'log-body';
  bodyEl.style.marginTop = '6px';
  bodyEl.style.borderColor = ok ? 'var(--green-dim)' : 'var(--red-dim)';
  bodyEl.textContent = JSON.stringify(data, null, 2);
  _lastLogEntry.appendChild(bodyEl);
}

function clearLog() {
  document.getElementById('logContainer').innerHTML =
    '<div class="log-empty">No API calls yet — generate a pre-signed URL to see responses here.</div>';
}

// ── Utilities ──────────────────────────────────
function showEl(id) { document.getElementById(id).style.display = 'block'; }
function hideEl(id) { document.getElementById(id).style.display = 'none'; }

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
}

function setLoading(btn, loading) {
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Init ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  updateExpiryLabel('download');
  updateExpiryLabel('upload');
});
