class Resolver {
  constructor(options = {}) {
    this.proxyBase = options.proxyBase || '/proxy';
  }

  resolve(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL');
    }

    const type = this.detectType(url);
    const strategy = this.selectStrategy(url, type);

    return {
      source: url,
      type,
      strategy,
      proxyRequired: strategy === 'proxy',
      headers: this.buildHeaders(url, strategy),
      fallbackChain: this.buildFallbackChain(url, type)
    };
  }

  detectType(url) {
    if (Utils.isYouTube(url)) return 'iframe';
    if (Utils.isVimeo(url)) return 'iframe';
    if (Utils.isHLS(url)) return 'hls';
    if (Utils.isDASH(url)) return 'dash';
    if (Utils.isVideo(url)) return 'mp4';
    if (Utils.isAudio(url)) return 'audio';
    if (Utils.isImage(url)) return 'image';
    return 'unknown';
  }

  selectStrategy(url, type) {
    if (type === 'iframe') return 'iframe';

    if (this.requiresProxy(url)) return 'proxy';

    if (type === 'hls')  return 'hls';
    if (type === 'dash') return 'dash';

    return 'native';
  }

  requiresProxy(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'blob:' || u.protocol === 'data:') return false;
      return u.hostname !== 'localhost';
    } catch {
      return true;
    }
  }

  buildHeaders(url, strategy) {
    if (strategy !== 'proxy') return {};

    return {
      'User-Agent': 'Mozilla/5.0',
      'Accept': '*/*',
      'Referer': this.getReferer(url)
    };
  }

  getReferer(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}`;
    } catch {
      return '';
    }
  }

  buildFallbackChain(url, type) {
    const chain = [];

    if (type === 'mp4') {
      chain.push('native', 'proxy');
    }

    if (type === 'hls') {
      chain.push('hls', 'proxy', 'mp4-fallback');
    }

    if (type === 'dash') {
      chain.push('dash', 'proxy');
    }

    if (type === 'iframe') {
      chain.push('iframe');
    }

    if (type === 'unknown') {
      chain.push('proxy', 'iframe');
    }

    return chain;
  }

  getProxyUrl(url) {
    return `${this.proxyBase}?url=${encodeURIComponent(url)}`;
  }
}

if (typeof window !== 'undefined') {
  window.Resolver = Resolver;
}
