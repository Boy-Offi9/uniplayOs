class Downloader {
  constructor(options = {}) {
    this.proxyBase = options.proxyBase || '/proxy';
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
    this.largeFileThreshold = options.largeFileThreshold || 256 * 1024 * 1024;
    this.controller = null;
  }

  cancel() {
    if (this.controller) this.controller.abort();
  }

  async download(url, filename) {
    const name = this._sanitizeFileName(filename || Utils.getFileName(url));

    try {
      if (this._isBlobUrl(url)) {
        this._trigger(url, name);
        this._emit('onComplete', { url, filename: name, mode: 'native' });
        return;
      }

      await this._fetchAndSave(url, name);
    } catch (err) {
      this._emit('onError', err);
      throw err;
    }
  }

  async _fetchAndSave(url, filename) {
    const proxied = this._needsProxy(url)
      ? `${this.proxyBase}?url=${encodeURIComponent(url)}`
      : url;

    this.controller = new AbortController();
    const signal = this.controller.signal;

    try {
      let response;
      try {
        response = await fetch(proxied, { signal });
      } catch (err) {
        throw this._normalizeError(err);
      }

      if (!response.ok) {
        throw await this._errorFromResponse(response);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const named = this._withExtension(filename, contentType);
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : null;

      if (total && total > this.largeFileThreshold) {
        const handle = await this._pickSaveTarget(named);
        if (handle) {
          const size = await this._streamToDisk(response, handle, total, signal);
          this._emit('onComplete', { url, filename: named, size, mode: 'disk' });
          return;
        }

        this.controller.abort();
        this._trigger(proxied, named);
        this._emit('onComplete', { url, filename: named, size: total, mode: 'native' });
        return;
      }

      const size = await this._saveInMemory(response, named, contentType, total, signal);
      this._emit('onComplete', { url, filename: named, size, mode: 'memory' });
    } finally {
      this.controller = null;
    }
  }

  async _saveInMemory(response, filename, contentType, total, signal) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        this._progress(received, total);
      }
    } catch (err) {
      throw this._normalizeError(err, signal);
    }

    const blobUrl = URL.createObjectURL(new Blob(chunks, { type: contentType }));
    this._trigger(blobUrl, filename);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    return received;
  }

  async _pickSaveTarget(filename) {
    if (typeof window === 'undefined' || typeof window.showSaveFilePicker !== 'function') return null;

    try {
      return await window.showSaveFilePicker({ suggestedName: filename });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const cancelled = new Error('Download cancelled');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      return null;
    }
  }

  async _streamToDisk(response, handle, total, signal) {
    const writable = await handle.createWritable();
    const reader = response.body.getReader();
    let received = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        received += value.length;
        this._progress(received, total);
      }
      await writable.close();
      return received;
    } catch (err) {
      try { await writable.abort(); } catch {}
      throw this._normalizeError(err, signal);
    }
  }

  async _errorFromResponse(response) {
    let detail = '';
    try {
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        const body = await response.json();
        detail = body && body.error ? String(body.error) : '';
      }
    } catch {}

    return new Error(detail
      ? `${detail} (${response.status})`
      : `Failed to fetch: ${response.status} ${response.statusText}`.trim());
  }

  _normalizeError(err, signal) {
    if ((signal && signal.aborted) || (err && err.name === 'AbortError')) {
      const cancelled = new Error('Download cancelled');
      cancelled.name = 'AbortError';
      return cancelled;
    }
    return err;
  }

  _progress(received, total) {
    if (this.onProgress && total) {
      this.onProgress({ received, total, percent: Math.min(100, Math.round((received / total) * 100)) });
    }
  }

  _emit(handler, payload) {
    if (!this[handler]) return;
    try {
      this[handler](payload);
    } catch (err) {
      console.error(`${handler} handler failed`, err);
    }
  }

  _sanitizeFileName(name) {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'download';
  }

  _withExtension(filename, contentType) {
    if (/\.[A-Za-z0-9]{1,5}$/.test(filename)) return filename;
    const extensions = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogv',
      'video/quicktime': 'mov',
      'video/x-matroska': 'mkv',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'weba',
      'audio/flac': 'flac',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    const extension = extensions[contentType.split(';')[0].trim().toLowerCase()];
    return extension ? `${filename}.${extension}` : filename;
  }

  _trigger(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  _isBlobUrl(url) {
    return url.startsWith('blob:');
  }

  _needsProxy(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'blob:' || u.protocol === 'data:') return false;
      return u.hostname !== 'localhost';
    } catch {
      return true;
    }
  }
}

if (typeof window !== 'undefined') {
  window.Downloader = Downloader;
}
