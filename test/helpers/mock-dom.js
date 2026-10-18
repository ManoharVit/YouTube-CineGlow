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

class MockElement extends EventTarget {
  constructor(tagName = 'div', attributes = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.classList = new MockClassList();
    this.children = [];
    this.style = {};

    for (const [k, v] of Object.entries(attributes)) {
      this.setAttribute(k, v);
    }
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

  querySelector(_selector) {
    return null;
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
MockMutationObserver.instances = [];

function setupMockEnvironment(initialUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
  MockMutationObserver.instances = [];
  const url = new URL(initialUrl);

  const listeners = new Map();
  const mockDocument = new MockElement('document');
  mockDocument.readyState = 'complete';
  mockDocument.fullscreenElement = null;
  mockDocument.pictureInPictureElement = null;

  const elements = new Map();

  mockDocument.querySelector = (sel) => {
    return elements.get(sel) || null;
  };

  const mockWindow = {
    location: {
      href: url.href,
      pathname: url.pathname,
      search: url.search,
      get searchParams() {
        return new URLSearchParams(this.search);
      }
    },
    document: mockDocument,
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    MutationObserver: MockMutationObserver,
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
      onChanged: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
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
