class Storage {
  static prefix = 'uniplayos:';

  static set(key, value) {
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(this.prefix + key, serialized);
      return true;
    } catch {
      return false;
    }
  }

  static get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  static remove(key) {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {}
  }

  static has(key) {
    try {
      return localStorage.getItem(this.prefix + key) !== null;
    } catch {
      return false;
    }
  }

  static clear() {
    this.keys().forEach((k) => this.remove(k));
  }

  static keys() {
    try {
      return Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix))
        .map(k => k.slice(this.prefix.length));
    } catch {
      return [];
    }
  }
}

if (typeof window !== 'undefined') {
  window.Storage = Storage;
}
