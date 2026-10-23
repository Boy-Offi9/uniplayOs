class StreamDownloader extends Downloader {
  constructor(options = {}) {
    super(options);
    this.concurrency = options.concurrency || 4;
    this.preferredHeight = options.preferredHeight || null;
    this.maxInMemoryBytes = options.maxInMemoryBytes || 2 * 1024 * 1024 * 1024;
    this.maxRetries = options.maxRetries || 4;
    this.keyCache = new Map();
    this.state = null;
  }

  static isStreamUrl(url) {
    return Utils.isHLS(url) || Utils.isDASH(url);
  }

  static defaultBaseName(url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
      const last = (segments.pop() || '').replace(/\.(m3u8|mpd)$/i, '');
      if (last && !/^(index|master|playlist|manifest|stream|main|chunklist|video)$/i.test(last)) return last;
      return segments.pop() || parsed.hostname || 'stream';
    } catch {
      return 'stream';
    }
  }

  async download(url, baseName) {
    const base = this._sanitizeFileName(baseName || StreamDownloader.defaultBaseName(url));

    this.controller = new AbortController();
    this.keyCache = new Map();
    let sinks = [];

    try {
      const plan = Utils.isDASH(url) && !Utils.isHLS(url)
        ? await this._planDash(url)
        : await this._planHls(url);

      const files = this._fileNames(base, plan.outputs);
      const opened = await this._openSinks(files);
      sinks = opened.sinks;

      this.state = {
        done: 0,
        total: plan.outputs.reduce((sum, output) => sum + output.items.filter((item) => !item.optional).length, 0),
        bytes: 0,
      };

      const results = [];
      for (let index = 0; index < plan.outputs.length; index++) {
        const size = await this._runOutput(plan.outputs[index].items, sinks[index]);
        await sinks[index].close();
        results.push({ filename: files[index].name, size });
      }

      const total = results.reduce((sum, file) => sum + file.size, 0);
      this._emit('onComplete', {
        url,
        filename: results[0].filename,
        files: results,
        size: total,
        mode: opened.mode,
        note: this._note(plan, files),
      });
      return results;
    } catch (err) {
      const normalized = this._normalizeError(err, this.controller && this.controller.signal);
      await Promise.all(sinks.map((sink) => sink.abort().catch(() => {})));
      this._emit('onError', normalized);
      throw normalized;
    } finally {
      this.controller = null;
      this.state = null;
    }
  }

  _note(plan, files) {
    const notes = [];
    if (files.length > 1) {
      notes.push(`Video and audio are separate tracks, so they were saved as two files. Merge them with: ffmpeg -i "${files[0].name}" -i "${files[1].name}" -c copy merged.mp4`);
    }
    if (files.some((file) => file.name.endsWith('.ts'))) {
      notes.push('Saved as MPEG-TS (.ts). Most desktop players open it; to convert, run: ffmpeg -i file.ts -c copy file.mp4');
    }
    return notes.join(' ');
  }

  _fileNames(base, outputs) {
    if (outputs.length === 1) {
      return [{ name: `${base}.${outputs[0].extension}`, type: outputs[0].type }];
    }
    return outputs.map((output) => ({
      name: `${base}.${output.role}.${output.extension}`,
      type: output.type,
    }));
  }

  _tick(bytes) {
    if (!this.state) return;
    this.state.done += 1;
    this.state.bytes += bytes;
    if (this.onProgress && this.state.total) {
      this.onProgress({
        received: this.state.bytes,
        total: null,
        percent: Math.min(100, Math.round((this.state.done / this.state.total) * 100)),
        segments: this.state.done,
        totalSegments: this.state.total,
      });
    }
  }

  async _openSinks(files) {
    const hasSavePicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
    const hasDirectoryPicker = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

    try {
      if (files.length === 1 && hasSavePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: files[0].name });
        return { mode: 'disk', sinks: [new DiskSink(await handle.createWritable())] };
      }

      if (files.length > 1 && hasDirectoryPicker) {
        const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
        const sinks = [];
        for (const file of files) {
          const handle = await directory.getFileHandle(file.name, { create: true });
          sinks.push(new DiskSink(await handle.createWritable()));
        }
        return { mode: 'disk', sinks };
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const cancelled = new Error('Download cancelled');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
    }

    return {
      mode: 'memory',
      sinks: files.map((file) => new MemorySink(file.name, file.type, this.maxInMemoryBytes, (url, name) => this._trigger(url, name))),
    };
  }

  async _runOutput(items, sink) {
    const signal = this.controller.signal;
    const pending = new Map();
    let written = 0;

    const start = (index) => {
      if (index >= items.length || pending.has(index)) return;
      const promise = this._fetchItem(items[index], signal);
      promise.catch(() => {});
      pending.set(index, promise);
    };

    for (let index = 0; index < Math.min(this.concurrency, items.length); index++) start(index);

    for (let index = 0; index < items.length; index++) {
      if (signal.aborted) throw this._normalizeError(null, signal);
      let data;
      try {
        data = await pending.get(index);
      } catch (err) {
        if (items[index].optional && !(signal && signal.aborted)) break;
        throw err;
      }
      pending.delete(index);
      start(index + this.concurrency);
      await sink.write(data);
      written += data.length;
      if (items[index].optional) {
        if (this.state) this.state.bytes += data.length;
      } else {
        this._tick(data.length);
      }
    }

    return written;
  }

  async _fetchItem(item, signal) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const headers = {};
        if (item.range) headers.Range = `bytes=${item.range.start}-${item.range.end}`;

        const response = await fetch(item.url, { signal, headers });

        if (response.status === 429 && attempt < this.maxRetries) {
          const wait = Math.min(30, parseFloat(response.headers.get('retry-after')) || attempt * 2);
          await response.arrayBuffer().catch(() => {});
          await this._sleep(wait * 1000, signal);
          continue;
        }

        if (!response.ok) {
          const error = await this._errorFromResponse(response);
          error.status = response.status;
          if (response.status >= 500 && attempt < this.maxRetries) {
            lastError = error;
            await this._sleep(500 * attempt, signal);
            continue;
          }
          throw error;
        }

        let bytes = new Uint8Array(await response.arrayBuffer());
        if (item.range && response.status === 200) {
          bytes = bytes.slice(item.range.start, item.range.end + 1);
        }

        if (item.key) bytes = await this._decrypt(bytes, item.key, item.sequence, signal);
        return bytes;
      } catch (err) {
        if ((signal && signal.aborted) || (err && err.name === 'AbortError')) throw this._normalizeError(err, signal);
        if (err && err.status && err.status < 500) throw err;
        lastError = err;
        if (attempt < this.maxRetries) await this._sleep(500 * attempt, signal);
      }
    }

    throw lastError || new Error('Segment download failed');
  }

  _sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(this._normalizeError(null, signal));
        }, { once: true });
      }
    });
  }

  async _decrypt(bytes, key, sequence, signal) {
    if (!(window.crypto && window.crypto.subtle)) {
      throw new Error('Encrypted streams can only be downloaded from a secure (HTTPS) page');
    }

    if (!this.keyCache.has(key.uri)) {
      const promise = (async () => {
        const response = await fetch(key.uri, { signal });
        if (!response.ok) throw await this._errorFromResponse(response);
        const raw = new Uint8Array(await response.arrayBuffer());
        if (raw.length !== 16) throw new Error('Unexpected encryption key size');
        return window.crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
      })();
      promise.catch(() => this.keyCache.delete(key.uri));
      this.keyCache.set(key.uri, promise);
    }

    const cryptoKey = await this.keyCache.get(key.uri);
    const iv = StreamDownloader.ivFor(key.iv, sequence);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, bytes);
    return new Uint8Array(decrypted);
  }

  static ivFor(ivAttribute, sequence) {
    const iv = new Uint8Array(16);
    if (ivAttribute) {
      const hex = ivAttribute.replace(/^0x/i, '').padStart(32, '0');
      for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16);
      return iv;
    }
    let value = sequence;
    for (let i = 15; i >= 8 && value > 0; i--) {
      iv[i] = value % 256;
      value = Math.floor(value / 256);
    }
    return iv;
  }

  _manifestUrl(url) {
    const target = this._needsProxy(url) ? `${this.proxyBase}?url=${encodeURIComponent(url)}` : url;
    return new URL(target, window.location.href).href;
  }

  async _fetchText(url) {
    const response = await fetch(url, { signal: this.controller.signal });
    if (!response.ok) throw await this._errorFromResponse(response);
    return response.text();
  }

  static parseAttributes(text) {
    const attributes = {};
    const pattern = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      attributes[match[1]] = match[2].replace(/^"|"$/g, '');
    }
    return attributes;
  }

  static resolveUrl(reference, base) {
    return new URL(reference, base).href;
  }

  static parseHlsMaster(text, baseUrl) {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const variants = [];
    const audio = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attributes = StreamDownloader.parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
        let next = i + 1;
        while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
        if (next >= lines.length) continue;
        const resolution = /^(\d+)x(\d+)$/.exec(attributes.RESOLUTION || '');
        variants.push({
          bandwidth: parseInt(attributes.BANDWIDTH, 10) || 0,
          height: resolution ? parseInt(resolution[2], 10) : 0,
          audioGroup: attributes.AUDIO || null,
          uri: StreamDownloader.resolveUrl(lines[next], baseUrl),
        });
        i = next;
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        const attributes = StreamDownloader.parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
        if (attributes.TYPE === 'AUDIO' && attributes.URI) {
          audio.push({
            groupId: attributes['GROUP-ID'] || null,
            name: attributes.NAME || '',
            isDefault: attributes.DEFAULT === 'YES',
            uri: StreamDownloader.resolveUrl(attributes.URI, baseUrl),
          });
        }
      }
    }

    return { variants, audio };
  }

  static pickByHeight(candidates, preferredHeight) {
    const ranked = [...candidates].sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
    if (!preferredHeight) return [...candidates].sort((a, b) => (b.bandwidth - a.bandwidth) || (b.height - a.height))[0];
    return ranked.find((candidate) => candidate.height && candidate.height <= preferredHeight) || ranked[ranked.length - 1];
  }

  static parseHlsMedia(text, baseUrl) {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const segments = [];
    let mediaSequence = 0;
    let key = null;
    let map = null;
    let range = null;
    let lastRangeEnd = 0;
    let endList = false;

    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
      } else if (line.startsWith('#EXT-X-KEY:')) {
        const attributes = StreamDownloader.parseAttributes(line.slice('#EXT-X-KEY:'.length));
        const method = attributes.METHOD || 'NONE';
        if (method === 'NONE') {
          key = null;
        } else if (method === 'AES-128' && attributes.URI) {
          key = { uri: StreamDownloader.resolveUrl(attributes.URI, baseUrl), iv: attributes.IV || null };
        } else {
          throw new Error(`Unsupported stream encryption (${method})`);
        }
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const attributes = StreamDownloader.parseAttributes(line.slice('#EXT-X-MAP:'.length));
        let mapRange = null;
        if (attributes.BYTERANGE) {
          const [length, offset] = attributes.BYTERANGE.split('@').map(Number);
          mapRange = { start: offset || 0, end: (offset || 0) + length - 1 };
        }
        map = { url: StreamDownloader.resolveUrl(attributes.URI, baseUrl), range: mapRange };
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
        const [length, offset] = line.slice('#EXT-X-BYTERANGE:'.length).split('@').map(Number);
        const start = Number.isFinite(offset) ? offset : lastRangeEnd;
        range = { start, end: start + length - 1 };
        lastRangeEnd = range.end + 1;
      } else if (line === '#EXT-X-ENDLIST') {
        endList = true;
      } else if (!line.startsWith('#')) {
        segments.push({
          url: StreamDownloader.resolveUrl(line, baseUrl),
          range,
          key,
          sequence: mediaSequence + segments.length,
        });
        range = null;
      }
    }

    return { segments, map, endList };
  }

  _innerPath(url) {
    try {
      const parsed = new URL(url);
      const inner = parsed.searchParams.get('url');
      if (inner) return new URL(inner).pathname.toLowerCase();
      const templated = parsed.pathname.match(/\/proxy\/t\/[^/]+\/(.*)$/);
      if (templated) return templated[1].split('?')[0].toLowerCase();
      return parsed.pathname.toLowerCase();
    } catch {
      return String(url).toLowerCase();
    }
  }

  _hlsOutput(playlist, role) {
    if (!playlist.endList) {
      throw new Error('Live streams can\'t be downloaded');
    }
    if (!playlist.segments.length) {
      throw new Error('The playlist has no segments');
    }

    const path = this._innerPath(playlist.segments[0].url);
    let extension = 'ts';
    let type = 'video/mp2t';

    if (playlist.map) {
      extension = role === 'audio' ? 'm4a' : 'mp4';
      type = role === 'audio' ? 'audio/mp4' : 'video/mp4';
    } else if (/\.aac$/.test(path)) {
      extension = 'aac';
      type = 'audio/aac';
    } else if (/\.mp3$/.test(path)) {
      extension = 'mp3';
      type = 'audio/mpeg';
    } else if (/\.(m4s|mp4|cmfv|cmfa)$/.test(path)) {
      extension = role === 'audio' ? 'm4a' : 'mp4';
      type = role === 'audio' ? 'audio/mp4' : 'video/mp4';
    }

    const items = [];
    if (playlist.map) items.push({ url: playlist.map.url, range: playlist.map.range });
    playlist.segments.forEach((segment) => items.push(segment));

    return { role, extension, type, items };
  }

  async _planHls(url) {
    const manifestUrl = this._manifestUrl(url);
    const text = await this._fetchText(manifestUrl);

    if (!text.includes('#EXT-X-STREAM-INF')) {
      return { outputs: [this._hlsOutput(StreamDownloader.parseHlsMedia(text, manifestUrl), 'video')] };
    }

    const master = StreamDownloader.parseHlsMaster(text, manifestUrl);
    if (!master.variants.length) throw new Error('No playable variants found in the playlist');

    const variant = StreamDownloader.pickByHeight(master.variants, this.preferredHeight);
    const video = this._hlsOutput(
      StreamDownloader.parseHlsMedia(await this._fetchText(variant.uri), variant.uri),
      'video'
    );
    const outputs = [video];

    if (variant.audioGroup) {
      const candidates = master.audio.filter((track) => track.groupId === variant.audioGroup);
      const track = candidates.find((candidate) => candidate.isDefault) || candidates[0];
      if (track) {
        outputs.push(this._hlsOutput(
          StreamDownloader.parseHlsMedia(await this._fetchText(track.uri), track.uri),
          'audio'
        ));
      }
    }

    return { outputs };
  }

  static parseIsoDuration(value) {
    const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value || '');
    if (!match) return 0;
    return (parseFloat(match[1]) || 0) * 86400
      + (parseFloat(match[2]) || 0) * 3600
      + (parseFloat(match[3]) || 0) * 60
      + (parseFloat(match[4]) || 0);
  }

  static substituteTemplate(template, values) {
    return template.replace(/\$(RepresentationID|Number|Bandwidth|Time)(?:%0(\d+)d)?\$|\$\$/g, (match, name, width) => {
      if (match === '$$') return '$';
      const value = String(values[name]);
      return width ? value.padStart(parseInt(width, 10), '0') : value;
    });
  }

  static childElements(element, name) {
    return Array.from(element.children).filter((child) => child.localName === name);
  }

  static dashBase(chain, manifestUrl) {
    return chain.reduce((base, element) => {
      const baseElement = StreamDownloader.childElements(element, 'BaseURL')[0];
      const text = baseElement && baseElement.textContent.trim();
      return text ? StreamDownloader.resolveUrl(text, base) : base;
    }, manifestUrl);
  }

  static dashItems(representation, chain, manifestUrl, totalSeconds) {
    const lineage = chain.concat(representation);
    const base = StreamDownloader.dashBase(lineage, manifestUrl);
    const values = {
      RepresentationID: representation.getAttribute('id') || '',
      Bandwidth: representation.getAttribute('bandwidth') || '',
    };

    const templates = lineage
      .map((element) => StreamDownloader.childElements(element, 'SegmentTemplate')[0])
      .filter(Boolean);

    if (templates.length) {
      const merged = {};
      let timeline = null;
      templates.forEach((template) => {
        Array.from(template.attributes).forEach((attribute) => { merged[attribute.name] = attribute.value; });
        const found = StreamDownloader.childElements(template, 'SegmentTimeline')[0];
        if (found) timeline = found;
      });

      if (!merged.media) throw new Error('Unsupported stream layout (template without media)');

      const items = [];
      if (merged.initialization) {
        items.push({ url: StreamDownloader.resolveUrl(StreamDownloader.substituteTemplate(merged.initialization, values), base) });
      }

      const timescale = parseFloat(merged.timescale) || 1;
      let number = parseInt(merged.startNumber, 10);
      if (!Number.isFinite(number)) number = 1;
      const mediaUrl = (time, segmentNumber) => ({
        url: StreamDownloader.resolveUrl(
          StreamDownloader.substituteTemplate(merged.media, { ...values, Number: segmentNumber, Time: time }),
          base
        ),
      });

      if (timeline) {
        let time = 0;
        for (const entry of StreamDownloader.childElements(timeline, 'S')) {
          if (entry.getAttribute('t') !== null) time = parseInt(entry.getAttribute('t'), 10);
          const duration = parseInt(entry.getAttribute('d'), 10);
          let repeat = parseInt(entry.getAttribute('r') || '0', 10);
          if (repeat < 0) {
            repeat = totalSeconds ? Math.max(0, Math.ceil((totalSeconds * timescale - time) / duration) - 1) : 0;
          }
          for (let i = 0; i <= repeat; i++) {
            items.push(mediaUrl(time, number));
            time += duration;
            number += 1;
          }
        }
        return items;
      }

      const duration = parseFloat(merged.duration);
      if (!duration || !totalSeconds) throw new Error('Can\'t determine the stream length');
      const count = Math.ceil(totalSeconds / (duration / timescale));
      for (let i = 0; i < count; i++) {
        items.push(mediaUrl(i * duration, number + i));
      }
      for (let i = 0; i < 2; i++) {
        const extra = mediaUrl((count + i) * duration, number + count + i);
        extra.optional = true;
        items.push(extra);
      }
      return items;
    }

    const lists = lineage
      .map((element) => StreamDownloader.childElements(element, 'SegmentList')[0])
      .filter(Boolean);

    if (lists.length) {
      const list = lists[lists.length - 1];
      const items = [];
      const toRange = (value) => {
        const match = /^(\d+)-(\d+)$/.exec(value || '');
        return match ? { start: parseInt(match[1], 10), end: parseInt(match[2], 10) } : null;
      };
      const initialization = StreamDownloader.childElements(list, 'Initialization')[0];
      if (initialization) {
        const source = initialization.getAttribute('sourceURL');
        items.push({
          url: source ? StreamDownloader.resolveUrl(source, base) : base,
          range: toRange(initialization.getAttribute('range')),
        });
      }
      StreamDownloader.childElements(list, 'SegmentURL').forEach((segment) => {
        const media = segment.getAttribute('media');
        items.push({
          url: media ? StreamDownloader.resolveUrl(media, base) : base,
          range: toRange(segment.getAttribute('mediaRange')),
        });
      });
      return items;
    }

    if (StreamDownloader.childElements(representation, 'BaseURL').length || StreamDownloader.childElements(representation, 'SegmentBase').length) {
      return [{ url: base }];
    }

    throw new Error('Unsupported stream layout');
  }

  async _planDash(url) {
    const manifestUrl = this._manifestUrl(url);
    const text = await this._fetchText(manifestUrl);
    const document = new DOMParser().parseFromString(text, 'application/xml');

    if (document.getElementsByTagName('parsererror').length) throw new Error('Could not read the DASH manifest');

    const root = document.documentElement;
    if (root.getAttribute('type') === 'dynamic') throw new Error('Live streams can\'t be downloaded');

    const periods = StreamDownloader.childElements(root, 'Period');
    if (periods.length !== 1) throw new Error('Multi-period streams aren\'t supported yet');
    const period = periods[0];

    if (document.getElementsByTagName('ContentProtection').length) {
      throw new Error('This stream is DRM-protected and can\'t be downloaded');
    }

    const totalSeconds = StreamDownloader.parseIsoDuration(
      period.getAttribute('duration') || root.getAttribute('mediaPresentationDuration')
    );

    const candidates = { video: [], audio: [] };
    StreamDownloader.childElements(period, 'AdaptationSet').forEach((set) => {
      StreamDownloader.childElements(set, 'Representation').forEach((representation) => {
        const mime = representation.getAttribute('mimeType') || set.getAttribute('mimeType') || '';
        const kind = set.getAttribute('contentType') || mime.split('/')[0];
        if (kind !== 'video' && kind !== 'audio') return;
        candidates[kind].push({
          representation,
          set,
          mime,
          bandwidth: parseInt(representation.getAttribute('bandwidth'), 10) || 0,
          height: parseInt(representation.getAttribute('height'), 10) || 0,
        });
      });
    });

    const outputs = [];

    const build = (kind, candidate) => {
      const mime = candidate.mime || (kind === 'video' ? 'video/mp4' : 'audio/mp4');
      const webm = mime.includes('webm');
      return {
        role: kind,
        extension: kind === 'video' ? (webm ? 'webm' : 'mp4') : (webm ? 'weba' : 'm4a'),
        type: mime,
        items: StreamDownloader.dashItems(candidate.representation, [root, period, candidate.set], manifestUrl, totalSeconds),
      };
    };

    if (candidates.video.length) {
      outputs.push(build('video', StreamDownloader.pickByHeight(candidates.video, this.preferredHeight)));
    }
    if (candidates.audio.length) {
      outputs.push(build('audio', [...candidates.audio].sort((a, b) => b.bandwidth - a.bandwidth)[0]));
    }
    if (!outputs.length) throw new Error('No downloadable video or audio found in the manifest');

    return { outputs };
  }
}

class DiskSink {
  constructor(writable) {
    this.writable = writable;
  }

  async write(chunk) {
    await this.writable.write(chunk);
  }

  async close() {
    await this.writable.close();
  }

  async abort() {
    await this.writable.abort();
  }
}

class MemorySink {
  constructor(filename, type, limit, trigger) {
    this.filename = filename;
    this.type = type;
    this.limit = limit;
    this.trigger = trigger;
    this.parts = [];
    this.size = 0;
  }

  async write(chunk) {
    this.size += chunk.length;
    if (this.size > this.limit) {
      throw new Error('Too large to assemble in memory. Use a Chromium-based browser to save straight to disk.');
    }
    this.parts.push(chunk);
  }

  async close() {
    const url = URL.createObjectURL(new Blob(this.parts, { type: this.type }));
    this.trigger(url, this.filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.parts = [];
  }

  async abort() {
    this.parts = [];
  }
}

if (typeof window !== 'undefined') {
  window.StreamDownloader = StreamDownloader;
}
