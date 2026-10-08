class Utils {
  static formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) {
      return '0:00';
    }
    
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  static parseTime(timeString) {
    const parts = timeString.split(':').map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }
  
  static getFileExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const clean = pathname.split('?')[0].split('#')[0];
      const parts = clean.split('.');
      if (parts.length < 2) return '';
      const ext = parts.pop().toLowerCase();
      return ext.includes('/') ? '' : ext;
    } catch {
      return '';
    }
  }
  
  static getFileName(url) {
    try {
      const cleanUrl = url.split('?')[0].split('#')[0];
      const parts = cleanUrl.split('/');
      return parts.pop() || 'download';
    } catch {
      return 'download';
    }
  }
  
  static getDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return '';
    }
  }
  
  static isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }
  
  static isVideo(url) {
    const ext = this.getFileExtension(url);
    return ['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ts', 'flv', 'wmv', '3gp'].includes(ext);
  }
  
  static isAudio(url) {
    const ext = this.getFileExtension(url);
    return ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext);
  }
  
  static isImage(url) {
    const ext = this.getFileExtension(url);
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff'].includes(ext);
  }
  
  static toWebVtt(text) {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (/^WEBVTT/.test(normalized)) return `${normalized}\n`;
    const body = normalized.replace(/^.*-->.*$/gm, (line) => line.replace(/,/g, '.'));
    return `WEBVTT\n\n${body}\n`;
  }

  static extractYouTubeId(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    let id = null;

    if (host === 'youtu.be') {
      id = parsed.pathname.split('/')[1];
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') {
        id = parsed.searchParams.get('v');
      } else {
        const match = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
        id = match ? match[1] : null;
      }
    }

    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  static parseVimeo(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    const idIndex = segments.findIndex((segment) => /^\d+$/.test(segment));
    if (idIndex === -1) return null;

    const id = segments[idIndex];
    const next = segments[idIndex + 1];
    const hash = parsed.searchParams.get('h') || (next && /^[0-9a-f]{8,}$/i.test(next) ? next : null);

    return { id, hash, url: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}` };
  }

  static isYouTube(url) {
    return this.extractYouTubeId(url) !== null;
  }
  
  static isVimeo(url) {
    return this.parseVimeo(url) !== null;
  }

  static getThumbnail(url) {
    const id = this.extractYouTubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : null;
  }
  
  static isHLS(url) {
    return /\.m3u8(?:$|[?#/&])|[/=]m3u8(?:$|[/?#&])/i.test(url);
  }
  
  static isDASH(url) {
    return /\.mpd(?:$|[?#/&])|[/=]mpd(?:$|[/?#&])|\/manifest\(format=mpd/i.test(url);
  }
  
  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }
  
  static generateShortId() {
    return Math.random().toString(36).substr(2, 6);
  }
  
  static randomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }
  
  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  static truncate(str, maxLength = 50) {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }
  
  static capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  static slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
  }
  
  static debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  static throttle(func, limit = 300) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  static once(func) {
    let ran = false;
    let result;
    return function(...args) {
      if (!ran) {
        ran = true;
        result = func.apply(this, args);
      }
      return result;
    };
  }
  
  static getElement(selector, context = document) {
    const el = context.querySelector(selector);
    if (!el) {
      throw new Error(`Element not found: ${selector}`);
    }
    return el;
  }
  
  static getElements(selector, context = document) {
    const els = context.querySelectorAll(selector);
    if (els.length === 0) {
      throw new Error(`No elements found: ${selector}`);
    }
    return els;
  }
  
  static toggleClass(element, className) {
    element.classList.toggle(className);
  }
  
  static addClass(element, className) {
    element.classList.add(className);
  }
  
  static removeClass(element, className) {
    element.classList.remove(className);
  }
  
  static hasClass(element, className) {
    return element.classList.contains(className);
  }
  
  static shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  
  static groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key];
      if (!result[group]) result[group] = [];
      result[group].push(item);
      return result;
    }, {});
  }
  
  static unique(array) {
    return [...new Set(array)];
  }
  
  static deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  
  static isEmpty(obj) {
    return Object.keys(obj).length === 0;
  }
  
  static merge(obj1, obj2) {
    return { ...obj1, ...obj2 };
  }
  
  static formatDate(date, format = 'short') {
    const d = new Date(date);
    if (format === 'short') {
      return d.toLocaleDateString();
    } else if (format === 'long') {
      return d.toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } else if (format === 'time') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleString();
  }
  
  static timeAgo(date) {
    const now = Date.now();
    const diff = now - new Date(date).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    return `${years}y ago`;
  }
  
  static isMobile() {
    return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }
  
  static isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
  
  static isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }
  
  static isFullscreen() {
    return document.fullscreenElement !== null;
  }
  
  static lightenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
  }
  
  static darkenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
  }
}

if (typeof window !== 'undefined') {
  window.Utils = Utils;
}
