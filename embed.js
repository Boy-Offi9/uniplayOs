class UniplayOSEmbed {
  constructor(options = {}) {
    this.container = options.container || '#uniplayos';
    this.source = options.source || null;
    this.sources = options.sources || [];
    this.theme = options.theme || 'dark';
    this.allowDownloads = options.allowDownloads !== false;
    this.width = options.width || '100%';
    this.height = options.height || '500px';
    this.autoplay = options.autoplay || false;
    this.debug = options.debug || false;
    this.onReady = options.onReady || null;
    this.onPlay = options.onPlay || null;
    this.onPause = options.onPause || null;
    this.onEnded = options.onEnded || null;
    this.onError = options.onError || null;
    this.onTimeUpdate = options.onTimeUpdate || null;
    this.onTrackChange = options.onTrackChange || null;
    this.onQualityLevels = options.onQualityLevels || null;
    this.onQualityChange = options.onQualityChange || null;
    this.onSubtitleTracks = options.onSubtitleTracks || null;
    this.onSubtitleChange = options.onSubtitleChange || null;
    this.subtitles = options.subtitles || [];
    
    this.iframe = null;
    this.messageHandler = null;
    this.isReady = false;
    
    this.init();
  }
  
  init() {
    const container = document.querySelector(this.container);
    if (!container) {
      console.error('UniplayOS: Container not found');
      return;
    }
    
    container.style.width = this.width;
    container.style.height = this.height;
    container.style.position = 'relative';
    
    this.createIframe(container);
    this.setupMessageListener();
  }
  
  createIframe(container) {
    this.iframe = document.createElement('iframe');
    this.iframe.src = this.getOSUrl();
    this.iframe.style.width = '100%';
    this.iframe.style.height = '100%';
    this.iframe.style.border = 'none';
    this.iframe.style.background = '#0a0a12';
    this.iframe.style.borderRadius = '12px';
    this.iframe.allow = 'autoplay; fullscreen; encrypted-media';
    this.iframe.allowFullscreen = true;
    
    container.appendChild(this.iframe);
  }
  
  getOSUrl() {
    const params = new URLSearchParams();
    
    if (this.source) {
      params.set('source', this.source);
    }
    
    if (this.sources.length > 0) {
      params.set('sources', JSON.stringify(this.sources));
    }

    if (this.subtitles.length > 0) {
      params.set('subtitles', JSON.stringify(this.subtitles));
    }
    
    if (this.theme) {
      params.set('theme', this.theme);
    }
    
    params.set('downloads', this.allowDownloads ? 'true' : 'false');
    
    if (this.autoplay) {
      params.set('autoplay', 'true');
    }
    
    if (this.debug) {
      params.set('debug', 'true');
    }
    
    const baseUrl = this.baseUrl || window.location.origin;
    this.playerOrigin = new URL(baseUrl).origin;
    return `${baseUrl}/player.html?${params.toString()}`;
  }
  
  setupMessageListener() {
    this.messageHandler = (event) => {
      if (event.origin !== this.playerOrigin) return;
      if (event.source !== this.iframe?.contentWindow) return;

      const data = event.data;
      if (!data || data.type !== 'uniplayos') return;
      
      switch(data.action) {
        case 'ready':
          this.isReady = true;
          if (this.onReady) this.onReady(data);
          break;
        case 'play':
          if (this.onPlay) this.onPlay(data);
          break;
        case 'pause':
          if (this.onPause) this.onPause(data);
          break;
        case 'ended':
          if (this.onEnded) this.onEnded(data);
          break;
        case 'error':
          if (this.onError) this.onError(data);
          break;
        case 'timeupdate':
          if (this.onTimeUpdate) this.onTimeUpdate(data);
          break;
        case 'trackchange':
          this.source = data.source;
          if (this.onTrackChange) this.onTrackChange(data);
          break;
        case 'qualitylevels':
          if (this.onQualityLevels) this.onQualityLevels(data);
          break;
        case 'qualitychange':
          if (this.onQualityChange) this.onQualityChange(data);
          break;
        case 'subtitletracks':
          if (this.onSubtitleTracks) this.onSubtitleTracks(data);
          break;
        case 'subtitlechange':
          if (this.onSubtitleChange) this.onSubtitleChange(data);
          break;
        case 'download':
          console.log('Download started:', data.url);
          break;
      }
    };

    window.addEventListener('message', this.messageHandler);
  }
  
  postMessage(action, data = {}) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage({
        type: 'uniplayos',
        action: action,
        ...data
      }, this.playerOrigin || '*');
    }
  }
  
  play() {
    this.postMessage('play');
  }
  
  pause() {
    this.postMessage('pause');
  }
  
  togglePlay() {
    this.postMessage('togglePlay');
  }
  
  seek(time) {
    this.postMessage('seek', { time });
  }
  
  setVolume(level) {
    this.postMessage('setVolume', { level });
  }
  
  toggleMute() {
    this.postMessage('toggleMute');
  }
  
  toggleFullscreen() {
    this.postMessage('toggleFullscreen');
  }

  setPlaybackRate(rate) {
    this.postMessage('setPlaybackRate', { rate });
  }

  setSubtitle(lang) {
    this.postMessage('setSubtitle', { lang });
  }

  setQuality(height) {
    this.postMessage('setQuality', { height });
  }

  setDebug(enabled) {
    this.postMessage('setDebug', { enabled });
  }

  next() {
    this.postMessage('next');
  }

  previous() {
    this.postMessage('previous');
  }
  
  load(source, subtitles = []) {
    this.source = source;
    this.postMessage('load', { source, subtitles });
  }
  
  destroy() {
    this.postMessage('destroy');
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    const container = document.querySelector(this.container);
    if (container) {
      container.innerHTML = '';
    }
  }
  
  static init(options) {
    return new UniplayOSEmbed(options);
  }
}

if (typeof window !== 'undefined') {
  window.UniplayOS = UniplayOSEmbed;
}
