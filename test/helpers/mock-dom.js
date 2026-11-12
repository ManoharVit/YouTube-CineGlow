// test/helpers/mock-dom.js
// Lightweight in-memory DOM, Web Audio, and Chrome API mocks for testing

class MockAudioParam {
  constructor(initialValue = 0) {
    this.value = initialValue;
  }
  setTargetAtTime(target, _startTime, _timeConstant) {
    this.value = target;
  }
  setValueAtTime(target, _startTime) {
    this.value = target;
  }
}

class MockAudioNode {
  constructor(context) {
    this.context = context;
    this.connections = [];
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
  disconnect(dest) {
    if (dest) {
      this.connections = this.connections.filter(c => c !== dest);
    } else {
      this.connections = [];
    }
  }
}

class MockGainNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.gain = new MockAudioParam(1);
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.fftSize = 2048;
  }
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getByteFrequencyData(_array) {}
}

class MockMediaElementAudioSourceNode extends MockAudioNode {
  constructor(context, mediaElement) {
    super(context);
    this.mediaElement = mediaElement;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new MockAudioNode(this);
    this.gainNodes = [];
    this.compressorNodes = [];
    this.filterNodes = [];
  }
  createGain() {
    const node = new MockGainNode(this);
    this.gainNodes.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const node = new MockDynamicsCompressorNode(this);
    this.compressorNodes.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new MockBiquadFilterNode(this);
    this.filterNodes.push(node);
    return node;
  }
  createAnalyser() {
    return new MockAnalyserNode(this);
  }
  createMediaElementSource(element) {
    if (element && element._hasMediaElementSource) {
      throw new Error('InvalidStateError: HTMLMediaElement already connected to a MediaElementSourceNode');
    }
    if (element) element._hasMediaElementSource = true;
    return new MockMediaElementAudioSourceNode(this, element);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

class MockClassList {
  constructor() {
    this._set = new Set();
  }
  add(...names) {
    names.forEach(n => this._set.add(n));
  }
  remove(...names) {
    names.forEach(n => this._set.delete(n));
  }
  contains(name) {
    return this._set.has(name);
  }
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this._set.add(name);
      else this._set.delete(name);
      return force;
    }
    if (this._set.has(name)) {
      this._set.delete(name);
      return false;
    } else {
      this._set.add(name);
      return true;
    }
  }
}

class MockStyle {
  constructor() {
    this._properties = new Map();
  }
  setProperty(name, value) {
    this._properties.set(String(name), String(value));
    this[name] = String(value);
  }
  removeProperty(name) {
    const prev = this.getPropertyValue(name);
    this._properties.delete(String(name));
    delete this[name];
    return prev;
  }
  getPropertyValue(name) {
    return this._properties.get(String(name)) || '';
  }
}

class MockElement extends EventTarget {
  constructor(tagName = 'div', attributes = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.classList = new MockClassList();
    this.children = [];
    this.style = new MockStyle();
    this.dataset = {};
    this.parentNode = null;
    this.parentElement = null;

    for (const [k, v] of Object.entries(attributes)) {
      this.setAttribute(k, v);
    }
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(val) {
    this.setAttribute('id', val);
  }

  get isConnected() {
    let curr = this.parentElement || this.parentNode;
    while (curr) {
      if (curr.tagName === 'DOCUMENT' || curr.tagName === 'HTML' || curr.tagName === 'BODY') return true;
      curr = curr.parentElement || curr.parentNode;
    }
    return false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') {
      String(value).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'class') this.classList = new MockClassList();
  }

  appendChild(child) {
    this.children.push(child);
    if (child && typeof child === 'object') {
      child.parentElement = this;
      child.parentNode = this;
    }
    return child;
  }

  prepend(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === 'object') {
        node.parentElement = this;
        node.parentNode = this;
      }
    }
    this.children.unshift(...nodes);
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      if (child && typeof child === 'object') {
        if (child.parentElement === this) child.parentElement = null;
        if (child.parentNode === this) child.parentNode = null;
      }
    }
    return child;
  }

  closest(selector) {
    return this;
  }

  matches(selector) {
    if (!selector || typeof selector !== 'string') return false;
    if (selector === ':hover' || selector === ':focus-within' || selector === ':focus') return false;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.toLowerCase() === this.tagName.toLowerCase()) return true;
    return false;
  }

  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    if (Array.isArray(this.children)) {
      for (const child of this.children) {
        if (child === node || (child.contains && child.contains(node))) return true;
      }
    }
    return false;
  }

  click() {
    this.dispatchEvent(new Event('click'));
  }

  remove() {
    const parent = this.parentElement || this.parentNode;
    if (parent && typeof parent.removeChild === 'function') {
      parent.removeChild(this);
    } else if (parent && Array.isArray(parent.children)) {
      const idx = parent.children.indexOf(this);
      if (idx !== -1) parent.children.splice(idx, 1);
      this.parentElement = null;
      this.parentNode = null;
    }
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 640, height: 360, bottom: 360, right: 640 };
  }

  querySelector(_selector) {
    return null;
  }

  getContext() {
    return {
      drawImage: () => {},
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) })
    };
  }

  captureStream() {
    return {
      getVideoTracks: () => [{ stop: () => {} }],
      getAudioTracks: () => [{ stop: () => {} }],
      addTrack: () => {},
      getTracks: () => [{ stop: () => {} }]
    };
  }
}

class MockVideoElement extends MockElement {
  constructor() {
    super('video');
    this.classList.add('html5-main-video');
    this.paused = true;
    this.ended = false;
    this.readyState = 4;
    this.cineGlowAudioAttached = false;
  }

  play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this.options = null;
    MockMutationObserver.instances.push(this);
  }

  observe(target, options) {
    this.target = target;
    this.options = options;
  }

  disconnect() {
    this.target = null;
    this.options = null;
  }

  trigger(mutations = []) {
    if (this.target) {
      this.callback(mutations, this);
    }
  }
}
class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

class MockMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video' || !t.kind); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  addTrack(t) { this.tracks.push(t); }
  removeTrack(t) {
    const idx = this.tracks.indexOf(t);
    if (idx !== -1) this.tracks.splice(idx, 1);
  }
}

MockMutationObserver.instances = [];

function setupMockEnvironment(initialUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
  MockMutationObserver.instances = [];
  const url = new URL(initialUrl);

  if (!globalThis.MutationObserver) {
    globalThis.MutationObserver = MockMutationObserver;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = MockResizeObserver;
  }
  if (!globalThis.MediaStream) {
    globalThis.MediaStream = MockMediaStream;
  }

  const listeners = new Map();
  const mockDocument = new MockElement('document');
  mockDocument.readyState = 'complete';
  mockDocument.fullscreenElement = null;
  mockDocument.pictureInPictureElement = null;

  const elements = new Map();

  mockDocument.querySelector = (sel) => {
    if (elements.has(sel)) return elements.get(sel);
    if (typeof sel === 'string' && sel.includes(',')) {
      const parts = sel.split(',').map(s => s.trim());
      for (const part of parts) {
        if (elements.has(part)) return elements.get(part);
      }
    }
    return null;
  };
  mockDocument.querySelectorAll = (sel) => {
    if (elements.has(sel)) return [elements.get(sel)];
    return [];
  };
  function findNodeById(node, id) {
    if (!node) return null;
    const actualId = (node.getAttribute && node.getAttribute('id')) || node.id;
    if (actualId === id) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  mockDocument.getElementById = (id) => {
    const direct = elements.get(`#${id}`) || elements.get(id);
    if (direct) return direct;
    const fromBody = findNodeById(mockDocument.body, id);
    if (fromBody) return fromBody;
    const fromDoc = findNodeById(mockDocument.documentElement, id);
    if (fromDoc) return fromDoc;
    return findNodeById(mockDocument, id);
  };
  mockDocument.createElement = (tag) => new MockElement(tag);
  mockDocument.head = new MockElement('head');
  mockDocument.body = new MockElement('body');
  mockDocument.documentElement = new MockElement('html');

  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = (blob) => `blob:mock-url-${Math.random().toString(36).slice(2)}`;
  }
  if (!globalThis.URL.revokeObjectURL) {
    globalThis.URL.revokeObjectURL = () => {};
  }
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (cb) => {
      const t = setTimeout(cb, 16);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    };
  }
  if (!globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  }

  const mockLocalStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };

  const mockWindow = {
    location: {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      get searchParams() {
        return new URLSearchParams(this.search);
      }
    },
    document: mockDocument,
    localStorage: mockLocalStorage,
    postMessage: () => {},
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    MutationObserver: MockMutationObserver,
    ResizeObserver: MockResizeObserver,
    MediaStream: MockMediaStream,
    EventTarget: globalThis.EventTarget,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    addEventListener: (type, fn, opts) => mockDocument.addEventListener(type, fn, opts),
    removeEventListener: (type, fn, opts) => mockDocument.removeEventListener(type, fn, opts),
    dispatchEvent: (evt) => mockDocument.dispatchEvent(evt)
  };

  const mockChrome = {
    storage: {
      sync: {
        _data: {},
        get: async (keys) => {
          if (typeof keys === 'string') {
            return { [keys]: mockChrome.storage.sync._data[keys] };
          }
          if (Array.isArray(keys)) {
            const out = {};
            keys.forEach(k => { out[k] = mockChrome.storage.sync._data[k]; });
            return out;
          }
          if (typeof keys === 'object' && keys !== null) {
            const out = { ...keys };
            for (const k of Object.keys(keys)) {
              if (k in mockChrome.storage.sync._data) {
                out[k] = mockChrome.storage.sync._data[k];
              }
            }
            return out;
          }
          return { ...mockChrome.storage.sync._data };
        },
        set: async (items) => {
          Object.assign(mockChrome.storage.sync._data, items);
        }
      },
      local: {
        _data: {},
        get: async (key) => ({ [key]: mockChrome.storage.local._data[key] }),
        set: async (items) => Object.assign(mockChrome.storage.local._data, items)
      },
      managed: {
        _data: {},
        get: async (keys) => {
          if (!keys) return { ...mockChrome.storage.managed._data };
          if (typeof keys === 'string') return { [keys]: mockChrome.storage.managed._data[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            keys.forEach(k => { out[k] = mockChrome.storage.managed._data[k]; });
            return out;
          }
          return { ...mockChrome.storage.managed._data };
        }
      },
      onChanged: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
      }
    },
    runtime: {
      getManifest: () => ({ version: '2.3.0' }),
      onMessage: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); },
        removeListener(fn) {
          this._listeners = this._listeners.filter(l => l !== fn);
        },
        dispatch(message, sender, sendResponse) {
          for (const l of this._listeners) {
            try {
              l(message, sender || {}, sendResponse || (() => {}));
            } catch (_) {}
          }
        }
      },
      sendMessage(msg, callback) {
        if (this.onMessage && typeof this.onMessage.dispatch === 'function') {
          this.onMessage.dispatch(msg, {}, callback);
        } else if (callback) {
          callback({ success: true });
        }
      },
      onInstalled: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
      },
      onStartup: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
      }
    },
    tabs: {
      _messages: [],
      query: (queryInfo, callback) => {
        const tabs = [{ id: 1, url: 'https://www.youtube.com/watch?v=mockVideo' }];
        if (callback) callback(tabs);
        return Promise.resolve(tabs);
      },
      sendMessage: (tabId, message, options, callback) => {
        mockChrome.tabs._messages.push({ tabId, message });
        if (typeof options === 'function') callback = options;
        if (mockChrome.runtime && mockChrome.runtime.onMessage) {
          mockChrome.runtime.onMessage.dispatch(message, { tab: { id: tabId } }, callback);
        }
        if (callback) callback({ success: true });
        return Promise.resolve({ success: true });
      }
    },
    scripting: {
      _registered: [],
      getRegisteredContentScripts: async () => mockChrome.scripting._registered,
      registerContentScripts: async (scripts) => { mockChrome.scripting._registered.push(...scripts); },
      unregisterContentScripts: async (filter) => {
        if (!filter || !filter.ids) {
          mockChrome.scripting._registered = [];
        } else {
          mockChrome.scripting._registered = mockChrome.scripting._registered.filter(s => !filter.ids.includes(s.id));
        }
      }
    },
    declarativeNetRequest: {
      _enabledRulesetIds: ['adblock_rules'],
      updateEnabledRulesets: async (options) => {
        if (options.disableRulesetIds) {
          mockChrome.declarativeNetRequest._enabledRulesetIds = mockChrome.declarativeNetRequest._enabledRulesetIds.filter(id => !options.disableRulesetIds.includes(id));
        }
        if (options.enableRulesetIds) {
          mockChrome.declarativeNetRequest._enabledRulesetIds.push(...options.enableRulesetIds);
        }
      }
    },
    alarms: {
      _alarms: {},
      _listeners: [],
      create: (name, alarmInfo) => { mockChrome.alarms._alarms[name] = alarmInfo; },
      clear: (name) => { delete mockChrome.alarms._alarms[name]; },
      onAlarm: {
        addListener(fn) { mockChrome.alarms._listeners.push(fn); }
      }
    }
  };

  return {
    window: mockWindow,
    document: mockDocument,
    chrome: mockChrome,
    elements,
    MockVideoElement,
    MockElement,
    MockAudioContext
  };
}

module.exports = {
  MockStyle,
  MockAudioParam,
  MockAudioNode,
  MockGainNode,
  MockDynamicsCompressorNode,
  MockBiquadFilterNode,
  MockAnalyserNode,
  MockAudioContext,
  MockElement,
  MockVideoElement,
  MockMutationObserver,
  setupMockEnvironment
};
