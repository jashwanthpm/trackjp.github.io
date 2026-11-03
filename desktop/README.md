# Sakkhi Desktop Companion

Cross-platform native companion for the Sakkhi local storage tracker.

## Purpose

The Sakkhi web app stores storage metadata in Supabase. The companion is installed on each desktop and performs local-only operations:

- Detect mounted volumes (macOS, Windows, Linux).
- Pick a folder using the native directory picker.
- Open the registered folder in Finder / File Explorer / the Linux file manager.
- Report local device and drive information to the signed-in Sakkhi web app.

Photo and video files are never uploaded, copied, moved, or indexed by this companion.

## Cross-device model

Supabase records are per user and per device. A path registered on one computer is displayed on another computer as metadata, but is never passed to that computer's file manager. Each computer must register its own local path for the same shoot.

The web app must show "Not registered on this device" if no local location exists. "Open folder" is enabled only after the companion confirms that the selected path exists on the current machine.

## Security requirements

- Bind any local bridge to loopback only; never listen on a LAN interface.
- Accept requests only from the official Sakkhi origin.
- Never accept arbitrary shell commands.
- Open only a canonical directory selected/registered by the user.
- Keep device secrets and local permission/bookmark state in the OS app-data directory.
- Supabase tables use authenticated-user RLS. No service-role key is shipped in the app.
- Do not sync file contents, thumbnails, or media names.

## Build

The desktop shell is a Tauri v2 app. Build artifacts should be signed/notarized for macOS and signed for Windows before public distribution. See the repository workflow for platform builds.
