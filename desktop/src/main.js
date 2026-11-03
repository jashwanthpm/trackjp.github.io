import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const frame = document.getElementById('sakkhi-frame');
const SAKKHI_ORIGIN = 'https://sakkhi.co.in';
const SUPABASE_URL = 'https://smyupcjfusgduaoxqfvu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNteXVwY2pmdXNnZHVhb3hxZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NjA3MzIsImV4cCI6MjA5NTQzNjczMn0.pGg9ZIYWpZ70R_HNtRl7FHrzeUNA5vlZT6hNkjDzhqo';
const PAIR_URL = `${SUPABASE_URL}/functions/v1/sakkhi-drive-pairing`;
const pairing = document.getElementById('pairing');
const codeEl = document.getElementById('pair-code');
const statusEl = document.getElementById('pair-status');
const openBtn = document.getElementById('pair-open');
let deviceSecret = null;
let pairingUrl = null;
let pollTimer = null;

async function beginPairing() {
  pairing.hidden = false;
  try {
    const context = await invoke('get_storage_context');
    const res = await fetch(PAIR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ action: 'start', device_name: context.device_name || 'This computer' }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not start pairing.');
    deviceSecret = data.device_secret;
    codeEl.textContent = data.user_code;
    pairingUrl = `${SAKKHI_ORIGIN}/app/?drive_pair=${encodeURIComponent(data.user_code)}`;
    statusEl.textContent = 'Code expires in 5 minutes. Approve it using your signed-in Sakkhi account.';
    openBtn.disabled = false;
    pollTimer = setInterval(checkPairing, 2000);
  } catch (error) {
    statusEl.textContent = error?.message || 'Could not start secure pairing. Please restart Sakkhi Drive.';
  }
}

openBtn.addEventListener('click', async () => {
  if (!pairingUrl) return;
  try { await invoke('open_pairing_url', { url: pairingUrl }); statusEl.textContent = 'Browser opened. Approve the pairing request there.'; }
  catch (error) { statusEl.textContent = error?.message || 'Could not open your browser.'; }
});

async function checkPairing() {
  if (!deviceSecret) return;
  try {
    const res = await fetch(PAIR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ action: 'poll', device_secret: deviceSecret }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pairing check failed.');
    if (data.status === 'pending') return;
    clearInterval(pollTimer);
    if (data.status !== 'approved' || !data.token_hash) {
      statusEl.textContent = 'This pairing code expired. Close and reopen Sakkhi Drive to try again.';
      openBtn.disabled = true;
      return;
    }
    statusEl.textContent = 'Approval received. Signing in securely…';
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ token_hash: data.token_hash, type: 'magiclink' }) });
    const session = await auth.json();
    if (!auth.ok || !session.access_token || !session.refresh_token || !session.user) throw new Error(session.msg || session.message || 'Could not complete desktop sign-in.');
    frame.contentWindow.postMessage({ source: 'sakkhi-desktop', command: 'pair_session', session }, SAKKHI_ORIGIN);
    deviceSecret = null;
    pairing.hidden = true;
  } catch (error) {
    clearInterval(pollTimer);
    statusEl.textContent = error?.message || 'Pairing failed. Please restart Sakkhi Drive.';
  }
}

window.addEventListener('message', async (event) => {
  if (event.source !== frame.contentWindow || event.origin !== SAKKHI_ORIGIN) return;
  const message = event.data;
  if (!message || message.source !== 'sakkhi-web' || !message.request_id) return;
  const reply = (payload) => frame.contentWindow.postMessage({ source: 'sakkhi-desktop', request_id: message.request_id, ...payload }, SAKKHI_ORIGIN);
  try {
    let result;
    switch (message.command) {
      case 'get_storage_context': result = await invoke('get_storage_context'); break;
      case 'pick_storage_folder': result = await openDialog({ directory: true, multiple: false, title: 'Choose a shoot folder' }); break;
      case 'open_storage_folder':
        result = await invoke('open_storage_folder', { rootPath: message.args?.rootPath || '', relativePath: message.args?.relativePath || '' }); break;
      default: throw new Error('Unsupported desktop request.');
    }
    reply({ ok: true, result });
  } catch (error) { reply({ ok: false, error: error?.message || String(error) }); }
});

frame.addEventListener('load', () => { document.getElementById('boot')?.remove(); });
beginPairing();
