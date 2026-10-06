// Mobile build (VITE_MOBILE=1) — the Capacitor shell is out of scope for GymTask
// (GYMTASK.md §5), so only the flag and the print hook the routine editor needs exist here.
// ponytail: printHtml is a stub — MOBILE is never set in this fork's builds; the upstream
// lib/mobile.js (Print plugin + Capacitor I/O) is the upgrade path if a native shell returns.
export const MOBILE = import.meta.env.VITE_MOBILE === '1'

export async function printHtml(html, name) {
  void html
  void name
}
