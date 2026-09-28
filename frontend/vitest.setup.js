// Node ≥ 24 defines a global `localStorage` accessor that is inert unless launched with
// --localstorage-file: reading it prints an ExperimentalWarning and yields undefined. happy-dom
// then finds the name already taken and installs no Storage of its own, so every DOM test dies at
// import time inside useStore.js (which reads localStorage at module scope). CI runs Node 22,
// where the name does not exist until the webstorage flag is passed, so this only bites newer
// local Nodes. Restore a working Storage in that case — a real `Storage` instance, not a custom
// class, because tests spy on `Storage.prototype.setItem` and an instance carrying its own
// methods would shadow the spy and miss every persisted write. Leave every other environment
// (CI's Node 22, happy-dom's own storage) untouched.
let probe = null
try { probe = globalThis.localStorage } catch { probe = null }

if (!probe) {
  class MemoryStorage {
    #m = new Map()
    get length() { return this.#m.size }
    clear() { this.#m.clear() }
    getItem(k) { return this.#m.has(String(k)) ? this.#m.get(String(k)) : null }
    key(i) { return [...this.#m.keys()][i] ?? null }
    removeItem(k) { this.#m.delete(String(k)) }
    setItem(k, v) { this.#m.set(String(k), String(v)) }
  }
  const make = () => {
    // Construct only — do NOT call setItem/getItem here. happy-dom's Storage proxy lazily binds
    // the first method it serves as an own property, capturing whatever is on Storage.prototype
    // at that moment; probing during setup would bind the ORIGINAL setItem before a test installs
    // vi.spyOn(Storage.prototype, 'setItem'), and the spy would then see zero writes.
    try { return new Storage() } catch { return null }
  }
  const storage = make() || new MemoryStorage()
  const define = obj => {
    if (!obj) return
    try {
      Object.defineProperty(obj, 'localStorage', {
        value: storage, configurable: true, writable: true
      })
    } catch { /* environment owns the name; leave it alone */ }
  }
  define(globalThis)
  define(typeof window !== 'undefined' ? window : null)
}
