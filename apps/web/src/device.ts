// Anonymous device identity for the phase-1 quota gate. Not user data —
// it survives "delete all data" because it only counts AI usage.
const DEVICE_KEY = 'lifeflow-web-device-v1'

export function deviceID(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}
