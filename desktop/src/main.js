import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const frame = document.getElementById('sakkhi-frame');
const SAKKHI_ORIGIN = 'https://sakkhi.co.in';

window.addEventListener('message', async (event) => {
  // Only accept requests from the official Sakkhi app iframe.
  if (event.source !== frame.contentWindow || event.origin !== SAKKHI_ORIGIN) return;
  const message = event.data;
  if (!message || message.source !== 'sakkhi-web' || !message.request_id) return;

  const reply = (payload) => {
    frame.contentWindow.postMessage(
      { source: 'sakkhi-desktop', request_id: message.request_id, ...payload },
      SAKKHI_ORIGIN
    );
  };

  try {
    let result;
    switch (message.command) {
      case 'get_storage_context':
        result = await invoke('get_storage_context');
        break;
      case 'pick_storage_folder':
        result = await openDialog({
          directory: true,
          multiple: false,
          title: 'Choose a shoot folder'
        });
        break;
      case 'open_storage_folder':
        result = await invoke('open_storage_folder', { path: message.args?.path || '' });
        break;
      default:
        throw new Error('Unsupported desktop request.');
    }
    reply({ ok: true, result });
  } catch (error) {
    reply({ ok: false, error: error?.message || String(error) });
  }
});

frame.addEventListener('load', () => {
  document.getElementById('boot')?.remove();
});
