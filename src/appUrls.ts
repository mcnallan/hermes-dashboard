const APP_BASE_URL = new URL(import.meta.env.BASE_URL || './', window.location.href)

function localPath(path: string) {
  return path.replace(/^\/+/, '')
}

export function appUrl(path: string) {
  return new URL(localPath(path), APP_BASE_URL).toString()
}

export function appWebSocketUrl(path: string) {
  const url = new URL(localPath(path), APP_BASE_URL)
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
