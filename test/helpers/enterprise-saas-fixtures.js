// test/helpers/enterprise-saas-fixtures.js
// Synthetic Enterprise SaaS DOM Fixtures & Security Staging Mocks
// Author / Lead Architect: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511 · https://github.com/ManoharVit)
'use strict';

const { setupMockEnvironment, MockElement, MockClassList } = require('./mock-dom');

/**
 * Traversal helper to search an element tree.
 * Supports selectors:
 *  - ID: '#myId' or '[id*="myId"]'
 *  - Class: '.myClass' or '[class*="myClass"]'
 *  - Tag: 'div', 'canvas', 'button', 'header', 'nav', 'input', 'style', 'link', etc.
 *  - Attributes: '[attr]', '[attr="val"]', '[attr*="val"]'
 *  - Comma-separated selectors: 'style, link[rel="stylesheet"]'
 */
function matchesSelector(element, selector) {
  if (!element || typeof selector !== 'string') return false;
  const sel = selector.trim();
  if (sel.includes(',')) {
    return sel.split(',').some(part => matchesSelector(element, part.trim()));
  }

  // ID selector #id
  if (sel.startsWith('#')) {
    const id = sel.slice(1);
    const actualId = (element.getAttribute && element.getAttribute('id')) || element.id;
    return actualId === id;
  }

  // Class selector .cls
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return element.classList && element.classList.contains(cls);
  }

  // Attribute selector [attr] or [attr="val"] or [attr*="val"]
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const inner = sel.slice(1, -1);
    if (inner.includes('*=')) {
      const [attr, val] = inner.split('*=').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      const actual = element.getAttribute ? element.getAttribute(attr) : element[attr];
      return typeof actual === 'string' && actual.includes(val);
    }
    if (inner.includes('=')) {
      const [attr, val] = inner.split('=').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      const actual = element.getAttribute ? element.getAttribute(attr) : element[attr];
      return String(actual) === val;
    }
    return element.hasAttribute ? element.hasAttribute(inner) : (element.getAttribute ? element.getAttribute(inner) !== null : inner in element);
  }

  // Tag with attribute (e.g., link[rel="stylesheet"])
  const tagAttrMatch = sel.match(/^([a-zA-Z0-9_-]+)\[(.+)\]$/);
  if (tagAttrMatch) {
    const [, tag, attrClause] = tagAttrMatch;
    if (element.tagName && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    return matchesSelector(element, `[${attrClause}]`);
  }

  // Tag name selector
  if (element.tagName && element.tagName.toLowerCase() === sel.toLowerCase()) {
    return true;
  }

  return false;
}

function findElements(root, selector, results = []) {
  if (!root) return results;
  const children = [];
  if (Array.isArray(root.children)) {
    children.push(...root.children);
  }
  if (root.body && !children.includes(root.body)) {
    children.push(root.body);
  }
  if (root.head && !children.includes(root.head)) {
    children.push(root.head);
  }
  if (root.documentElement && !children.includes(root.documentElement)) {
    children.push(root.documentElement);
  }

  for (const child of children) {
    if (matchesSelector(child, selector)) {
      results.push(child);
    }
    findElements(child, selector, results);
  }
  return results;
}

// Augment base MockElement.prototype with robust DOM querying and shadowRoot
MockElement.prototype.querySelectorAll = function(selector) {
  return findElements(this, selector);
};

MockElement.prototype.querySelector = function(selector) {
  const matches = findElements(this, selector);
  return matches.length > 0 ? matches[0] : null;
};

MockElement.prototype.attachShadow = function(options = { mode: 'open' }) {
  this.shadowRoot = new EnhancedMockElement('shadow-root', { 'data-mode': options.mode });
  this.shadowRoot.host = this;
  return this.shadowRoot;
};

// Ensure className getter/setter behaves consistently
if (!Object.getOwnPropertyDescriptor(MockElement.prototype, 'id')) {
  Object.defineProperty(MockElement.prototype, 'id', {
    get() {
      return (this.getAttribute && this.getAttribute('id')) || this._id || '';
    },
    set(val) {
      this._id = String(val);
      if (this.setAttribute) this.setAttribute('id', String(val));
    },
    configurable: true
  });
}

if (!Object.getOwnPropertyDescriptor(MockElement.prototype, 'className')) {
  Object.defineProperty(MockElement.prototype, 'className', {
    get() {
      if (this._classNameObj) return this._classNameObj;
      return Array.from(this.classList._set).join(' ');
    },
    set(val) {
      if (typeof val === 'object' && val !== null) {
        this._classNameObj = val;
        return;
      }
      this._classNameObj = null;
      this.classList._set.clear();
      if (val) String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
  });
}

/**
 * EnhancedMockElement subclass extending MockElement
 */
class EnhancedMockElement extends MockElement {
  constructor(tagName = 'div', attributes = {}) {
    super(tagName, attributes);
    this.shadowRoot = null;
  }
}

// Ensure globalThis.location exists in Node.js for scripts that access location.pathname directly
let activeWindowLocation = null;
if (!('location' in globalThis)) {
  Object.defineProperty(globalThis, 'location', {
    get() {
      return activeWindowLocation || {
        href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        pathname: '/watch',
        search: '?v=dQw4w9WgXcQ',
        hostname: 'www.youtube.com',
        origin: 'https://www.youtube.com'
      };
    },
    set(loc) {
      activeWindowLocation = loc;
    },
    configurable: true
  });
}

const SAAS_CONFIGS = {
  workday: {
    name: 'Workday',
    url: 'https://myworkday.com/corporate/home',
    domain: 'https://myworkday.com/corporate/home',
    bodyClass: 'wd-theme-modern wd-body wd-Workday wd-Application wd-Layout',
    rootId: 'workday-app',
    rootClass: 'wd-app',
    globals: {
      workday: { version: '2024.2', tenant: 'corporate', authenticated: true },
      wd: { trackEvent: () => {}, getSessionId: () => 'wd-sess-98765' }
    },
    sampleEndpoint: 'https://myworkday.com/corporate/api/v1/workers/me',
    classes: ['wd-Workday', 'wd-Application', 'wd-Layout'],
    elements: [
      { tag: 'header', class: 'wd-header', attrs: { role: 'banner', 'data-automation-id': 'global-header' } },
      { tag: 'input', class: 'wd-input wd-search', attrs: { placeholder: 'Search Workday', 'data-automation-id': 'globalSearch' } },
      { tag: 'nav', class: 'wd-nav', attrs: { 'data-automation-id': 'primaryNav' } },
      { tag: 'main', class: 'wd-main-content', attrs: { 'data-automation-id': 'landingPage' } },
      { tag: 'div', class: 'wd-card', attrs: { 'data-automation-id': 'workerSummary' } },
      { tag: 'div', class: 'wd-grid wd-timesheet', attrs: { 'data-automation-id': 'timesheetGrid' } }
    ]
  },
  salesforce: {
    name: 'Salesforce Lightning',
    url: 'https://company.my.salesforce.com/lightning/page/home',
    domain: 'https://company.my.salesforce.com/lightning/page/home',
    bodyClass: 'desktop slds-theme_default',
    rootId: 'auraApp',
    rootClass: 'slds-grid slds-wrap brandBand_1 slds-brand-band slds-template__default oneAppLayout',
    globals: {
      $A: { enqueueAction: () => {}, get: () => {}, getComponent: () => ({}) },
      sforce: { one: { navigateToURL: () => {} }, console: {} },
      Aura: { framework: 'LWC', version: '246.0' }
    },
    sampleEndpoint: 'https://company.my.salesforce.com/aura?r=1&aura.format=json',
    classes: ['slds-brand-band', 'slds-template__default', 'oneAppLayout'],
    elements: [
      { tag: 'header', class: 'slds-global-header_container', attrs: {} },
      { tag: 'input', class: 'slds-input', attrs: { placeholder: 'Search Salesforce' } },
      { tag: 'one-app-nav-bar', class: 'slds-context-bar', attrs: {} },
      { tag: 'div', class: 'oneWorkspace slds-col slds-size_1-of-1', attrs: {} },
      { tag: 'lightning-card', class: 'slds-card', attrs: {} },
      { tag: 'table', class: 'slds-table slds-table_bordered', attrs: {} }
    ]
  },
  sap: {
    name: 'SAP Fiori Launchpad',
    url: 'https://fiori.corp.sap.com/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html',
    domain: 'https://fiori.corp.sap.com/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html',
    bodyClass: 'sapUiBody sapUiTheme-sap_horizon sapUshellShell sapMPage',
    rootId: 'canvas',
    rootClass: 'sapUshellShell sapMShell',
    globals: {
      sap: {
        ui: {
          version: '1.120.0',
          getCore: () => ({ getConfiguration: () => ({ getTheme: () => 'sap_horizon' }) })
        },
        ushell: { Container: { getService: () => ({}) } }
      },
      hasSapUi5: true
    },
    sampleEndpoint: 'https://fiori.corp.sap.com/sap/opu/odata/sap/ESH_SEARCH_SRV/$batch',
    classes: ['sapUiBody', 'sapUshellShell', 'sapMPage'],
    elements: [
      { tag: 'header', class: 'sapUshellShellHead', attrs: { id: 'shell-header' } },
      { tag: 'button', class: 'sapMBtn', attrs: { id: 'meAreaHeaderButton' } },
      { tag: 'div', class: 'sapUshellDashboardGroupsContainer', attrs: { id: 'dashboardGroups' } },
      { tag: 'div', class: 'sapUshellTile', attrs: { id: 'tile_orders' } }
    ]
  },
  servicenow: {
    name: 'ServiceNow',
    url: 'https://service-now.com/navpage.do',
    domain: 'https://service-now.com/navpage.do',
    bodyClass: 'sn-polaris sn-theme-polaris sn-polaris-layout sn-header navpage-layout',
    rootId: 'sn-app',
    rootClass: 'now-canvas-app polaris-container',
    globals: {
      g_user: { userName: 'admin', userID: 'usr_sn_123', hasRole: () => true },
      g_form: { getValue: () => 'INC0012345', isNewRecord: () => false },
      NOW: { polaris: true, version: 'Washington DC' }
    },
    sampleEndpoint: 'https://service-now.com/api/now/table/incident',
    classes: ['sn-polaris-layout', 'sn-header', 'navpage-layout'],
    elements: [
      { tag: 'header', class: 'now-unified-nav', attrs: { role: 'banner' } },
      { tag: 'button', class: 'now-button', attrs: { id: 'sn-all-menu' } },
      { tag: 'div', class: 'form-container glide-form-container', attrs: {} },
      { tag: 'input', class: 'form-control', attrs: { id: 'incident.short_description' } }
    ]
  },
  jira: {
    name: 'Jira Software',
    url: 'https://jira.atlassian.net/jira/software/projects',
    domain: 'https://jira.atlassian.net/jira/software/projects',
    bodyClass: 'ak-theme-dark jira-software ak-theme-default jira-project-board ghx-work',
    rootId: 'app',
    rootClass: 'css-atlassian-root',
    globals: {
      AJS: { contextPath: () => '', params: { baseUrl: 'https://jira.atlassian.net' } },
      gh: { board: { getId: () => 42 } },
      jira: { project: 'AURA', boardId: '101' }
    },
    sampleEndpoint: 'https://jira.atlassian.net/rest/api/2/issue/AURA-123',
    classes: ['ak-theme-default', 'jira-project-board', 'ghx-work'],
    elements: [
      { tag: 'header', class: 'css-header', attrs: { role: 'banner' } },
      { tag: 'div', class: 'css-sidebar', attrs: { id: 'sidebar' } },
      { tag: 'div', class: 'ghx-work', attrs: { id: 'ghx-work' } },
      { tag: 'div', class: 'ghx-column-headers', attrs: {} },
      { tag: 'div', class: 'ghx-swimlane', attrs: {} },
      { tag: 'div', class: 'ghx-issue', attrs: { 'data-issue-id': 'AURA-1001' } }
    ]
  },
  m365: {
    name: 'Microsoft 365',
    url: 'https://portal.office.com',
    domain: 'https://portal.office.com',
    bodyClass: 'ms-Fabric o365cs-base m365-landing-page',
    rootId: 'm365-shell',
    rootClass: 'm365-container ms-Fabric--isFocusHidden',
    globals: {
      Microsoft: { Office: { version: '16.0.0' } },
      _spPageContextInfo: { webServerRelativeUrl: '/', userId: 'corp_usr_42' },
      m365Config: { tenant: 'enterprise.onmicrosoft.com' }
    },
    sampleEndpoint: 'https://graph.microsoft.com/v1.0/me',
    classes: ['ms-Fabric', 'o365cs-base', 'm365-landing-page'],
    elements: [
      { tag: 'header', class: 'o365cs-nav-header', attrs: { id: 'O365_NavHeader' } },
      { tag: 'button', class: 'o365cs-nav-button', attrs: { id: 'O365_MainLink_NavMenu' } },
      { tag: 'div', class: 'm365-app-launcher', attrs: {} },
      { tag: 'div', class: 'm365-recent-docs', attrs: {} },
      { tag: 'div', class: 'm365-feed', attrs: {} }
    ]
  }
};

class MockStorageArea {
  constructor(initialData = {}) {
    this._data = { ...initialData };
  }
  async get(keys) {
    if (!keys) return { ...this._data };
    if (typeof keys === 'string') return { [keys]: this._data[keys] };
    if (Array.isArray(keys)) {
      const out = {};
      keys.forEach(k => { out[k] = this._data[k]; });
      return out;
    }
    if (typeof keys === 'object' && keys !== null) {
      const out = { ...keys };
      for (const k of Object.keys(keys)) {
        if (k in this._data) out[k] = this._data[k];
      }
      return out;
    }
    return { ...this._data };
  }
  async set(items) {
    Object.assign(this._data, items);
  }
  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach(k => delete this._data[k]);
  }
  async clear() {
    this._data = {};
  }
}

class MockIdentity {
  constructor() {
    this._token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vY29ycC10ZW5hbnQtdXVpZC92Mi4wIiwic3ViIjoiZW1wbG95ZWUxMjMiLCJhdWQiOiJjaW5lZ2xvdy1lbnRlcnByaXNlIiwiZXhwIjoxODkzNDU2MDAwfQ.mock_signature';
    this._shouldFailInteractiveFalse = false;
  }
  getRedirectURL(path = '') {
    return `https://cineglow-mock-extension-id.chromiumapp.org/${path}`;
  }
  async getAuthToken(details = {}) {
    if (details.interactive === false && this._shouldFailInteractiveFalse) {
      throw new Error('OAuth2 flow failed: User interaction required');
    }
    return this._token;
  }
  async launchWebAuthFlow(details = {}) {
    if (!details.url) throw new Error('Missing url parameter in launchWebAuthFlow');
    const parsedUrl = new URL(details.url);
    const isEntraOrOkta = parsedUrl.hostname === 'login.microsoftonline.com' ||
                          parsedUrl.hostname.endsWith('.okta.com');
    if (!isEntraOrOkta) {
      throw new Error(`Untrusted IdP domain: ${parsedUrl.hostname}`);
    }
    if (details.interactive === false && this._shouldFailInteractiveFalse) {
      throw new Error('Authorization page could not be loaded without user interaction');
    }
    const redirectUri = parsedUrl.searchParams.get('redirect_uri') || this.getRedirectURL();
    return `${redirectUri}#access_token=${this._token}&token_type=Bearer&expires_in=3600`;
  }
  async clearAllCachedAuthTokens() {
    this._token = null;
  }
}

class MockManagement {
  constructor(installType = 'admin', mayDisable = false) {
    this._installType = installType;
    this._mayDisable = mayDisable;
    this._enabled = true;
  }
  async getSelf() {
    return {
      id: 'cineglow-pro-extension-id',
      name: 'CineGlow Pro for YouTube',
      version: '2.3.0',
      installType: this._installType,
      mayDisable: this._mayDisable,
      enabled: this._enabled
    };
  }
  async setEnabled(id, enabled) {
    if (this._installType === 'admin' && !this._mayDisable && !enabled) {
      throw new Error('Extension cannot be disabled by user: managed by enterprise policy (ExtensionInstallForcelist)');
    }
    this._enabled = !!enabled;
  }
  async uninstallSelf() {
    if (this._installType === 'admin') {
      throw new Error('Extension cannot be uninstalled by user: managed by enterprise policy');
    }
    this._enabled = false;
  }
}

function createSaaSDOM(appName, options = {}) {
  const key = String(appName).toLowerCase();
  const config = SAAS_CONFIGS[key];
  if (!config) {
    throw new Error(`Unsupported SaaS application: ${appName}. Supported: ${Object.keys(SAAS_CONFIGS).join(', ')}`);
  }

  const targetUrl = options.url || config.url;
  const env = setupMockEnvironment(targetUrl);
  const doc = env.document;
  const win = env.window;

  // Set active location for globalThis
  activeWindowLocation = win.location;

  doc.title = `${config.name} Corporate Portal`;

  if (config.bodyClass) {
    config.bodyClass.split(/\s+/).filter(Boolean).forEach(cls => doc.body.classList.add(cls));
  }

  const root = new MockElement('div', { id: config.rootId, class: config.rootClass });
  doc.body.appendChild(root);
  env.elements.set(`#${config.rootId}`, root);

  const primaryRootClass = config.rootClass ? config.rootClass.split(' ')[0] : null;
  if (primaryRootClass) {
    env.elements.set(`.${primaryRootClass}`, root);
  }

  if (config.elements) {
    for (const elSpec of config.elements) {
      const el = new MockElement(elSpec.tag, { class: elSpec.class, ...elSpec.attrs });
      root.appendChild(el);
      if (elSpec.attrs?.id) {
        env.elements.set(`#${elSpec.attrs.id}`, el);
      }
      if (elSpec.class) {
        const firstClass = elSpec.class.split(' ')[0];
        if (firstClass) {
          env.elements.set(`.${firstClass}`, el);
        }
      }
    }
  }

  if (config.globals) {
    for (const [k, v] of Object.entries(config.globals)) {
      win[k] = v;
    }
  }

  const networkCalls = [];
  async function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    const callRecord = {
      type: 'fetch',
      url,
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body || null
    };
    networkCalls.push(callRecord);
    return {
      status: 200,
      ok: true,
      headers: { 'Content-Type': 'application/json' },
      json: async () => ({ status: 'ok', app: config.name, url }),
      text: async () => JSON.stringify({ status: 'ok', app: config.name, url })
    };
  }

  class MockXHR extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.headers = new Map();
      this.method = 'GET';
      this.url = '';
    }
    open(method, url) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(k, v) {
      this.headers.set(k, v);
      this.headers[k] = v;
    }
    send(body = null) {
      networkCalls.push({
        type: 'xhr',
        url: this.url,
        method: this.method,
        headers: Object.fromEntries(this.headers.entries ? this.headers.entries() : Object.entries(this.headers)),
        body
      });
      this.readyState = 4;
      this.status = 200;
      this.responseText = JSON.stringify({ status: 'ok', app: config.name, url: this.url });
      this.dispatchEvent(new Event('load'));
    }
  }

  win.fetch = fetch;
  win.XMLHttpRequest = MockXHR;

  win.localStorage = win.localStorage || {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };

  win.sessionStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };

  env.chrome.storage.session = new MockStorageArea();
  env.chrome.identity = new MockIdentity();
  env.chrome.management = new MockManagement();

  function serializeTree(node) {
    if (!node) return null;
    return {
      tag: node.tagName || 'UNKNOWN',
      id: node.getAttribute ? node.getAttribute('id') : null,
      class: node.getAttribute ? node.getAttribute('class') : null,
      children: Array.isArray(node.children) ? node.children.map(serializeTree) : []
    };
  }

  function snapshot() {
    return {
      title: doc.title,
      bodyClass: Array.from(doc.body.classList._set).sort(),
      rootChildrenCount: root.children.length,
      globals: Object.keys(config.globals).map(k => ({
        key: k,
        exists: win[k] !== undefined,
        type: typeof win[k]
      })),
      networkCallCount: networkCalls.length,
      elementsCount: env.elements.size,
      domTree: serializeTree(root)
    };
  }

  // Enhanced querySelectorAll on document
  doc.querySelectorAll = function(sel) {
    return findElements(doc, sel);
  };
  doc.querySelector = function(sel) {
    const res = findElements(doc, sel);
    return res.length > 0 ? res[0] : null;
  };

  return {
    appName: key,
    config,
    env,
    window: win,
    document: doc,
    chrome: env.chrome,
    appRoot: root,
    root,
    networkCalls,
    nativeFetch: fetch,
    MockXHR,
    MockIdentity,
    MockStorageArea,
    MockManagement,
    snapshot
  };
}

function setupEnterpriseYouTubeEnvironment(options = {}) {
  const env = setupMockEnvironment(options.url || 'https://www.youtube.com/watch?v=enterpriseTest');
  activeWindowLocation = env.window.location;

  env.document.createElementNS = (ns, tag) => {
    const el = new MockElement(tag);
    el.className = { baseVal: '' };
    return el;
  };

  env.chrome.storage.session = new MockStorageArea();
  env.chrome.identity = new MockIdentity();
  env.chrome.management = new MockManagement();

  return env;
}

module.exports = {
  createSaaSDOM,
  SAAS_CONFIGS,
  EnhancedMockElement,
  matchesSelector,
  findElements,
  MockStorageArea,
  MockIdentity,
  MockManagement,
  setupEnterpriseYouTubeEnvironment
};
