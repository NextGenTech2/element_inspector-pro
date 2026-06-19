# Element Inspector Pro — Exact Reproduction Prompt

Build a Chrome Extension (Manifest V3) called **"Element Inspector Pro"** delivered as a ZIP with these exact files:
- `manifest.json`
- `content.js`
- `overlay.css`
- `popup.html`
- `popup.js`
- `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Element Inspector Pro",
  "version": "1.0.0",
  "description": "Identify all page elements including React & Shadow DOM. Generate Playwright/Selenium/Cypress selectors for test automation.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["overlay.css"],
    "run_at": "document_idle"
  }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

---

## popup.html

280px wide popup. Dark theme `#0f1117`. Header with gradient logo `🔍` + title "Element Inspector Pro" + subtitle "Test Automation Selector Generator". Body has two buttons:
- "Open Inspector Panel" — primary gradient button `linear-gradient(135deg, #6366f1, #8b5cf6)`
- "Close Panel" — secondary button `#1e2433` border `#2d3748`
- Status div below showing confirmation message

---

## popup.js

```js
document.getElementById('togglePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.__elementInspectorPanel) {
          window.__elementInspectorPanel.show();
        } else {
          window.dispatchEvent(new CustomEvent('EIP_INIT'));
        }
      }
    });
    document.getElementById('status').textContent = '✓ Panel opened on page';
    document.getElementById('status').className = 'status active';
  } catch (e) {
    document.getElementById('status').textContent = '✗ Cannot access this page';
  }
  setTimeout(() => window.close(), 700);
});

document.getElementById('closePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { if (window.__elementInspectorPanel) window.__elementInspectorPanel.hide(); }
    });
  } catch (e) {}
  window.close();
});
```

---

## content.js — Full Implementation

Wrap everything in an IIFE with this exact guard at the top:

```js
(function () {
  'use strict';
  if (window.__EIP_LOADED) {
    if (window.__elementInspectorPanel) window.__elementInspectorPanel.show();
    return;
  }
  window.__EIP_LOADED = true;
  // ... rest of code
})();
```

### 1. Generic data-* Attribute Scanner

```js
const DATA_ATTR_SKIP = new Set([
  'data-state','data-orientation','data-disabled','data-checked',
  'data-selected','data-active','data-open','data-closed',
  'data-expanded','data-collapsed','data-highlighted','data-variant',
  'data-size','data-color','data-theme','data-side','data-align',
  'data-position','data-placement','data-radix','data-slot','data-scope',
]);

function scoreDataAttr(n) {
  if (n.includes('test'))                          return 100;
  if (n.includes('cy') || n.includes('cypress'))   return 75;
  if (n.includes('qa'))                            return 70;
  if (n.includes('auto') || n.includes('e2e'))     return 65;
  if (n.includes('pw') || n.includes('wdio'))      return 65;
  if (n.includes('selenium'))                      return 65;
  if (n.includes('hook'))                          return 60;
  if (n.includes('id'))                            return 80;
  if (n.includes('component') || n.includes('element') ||
      n.includes('ref') || n.includes('handle'))   return 50;
  return 10;
}

function getBestDataAttr(el) {
  if (!el || !el.attributes) return null;
  let best = null, bestScore = -1;
  for (const attr of el.attributes) {
    const name = attr.name;
    if (!name.startsWith('data-')) continue;
    if (DATA_ATTR_SKIP.has(name)) continue;
    const val = attr.value;
    if (!val || val.length > 100 || /^\s*$/.test(val)) continue;
    const score = scoreDataAttr(name) + (name.length <= 12 ? 10 : 0);
    if (score > bestScore) { bestScore = score; best = { attr: name, value: val }; }
  }
  return best;
}
```

### 2. State Object

```js
const state = {
  panelVisible: false,
  hoverMode: false,
  scanDepth: 1,
  options: {
    scope: 'interactive',    // 'all' | 'interactive'
    selectorType: 'css',     // 'css' | 'xpath' | 'both'
    framework: 'playwright', // 'playwright' | 'selenium' | 'cypress'
    language: 'java',        // 'java' | 'python'
    exportFormat: 'json',    // 'json' | 'csv'
  },
  treeData: [],
  selectedElements: [],
  searchQuery: '',
};
let panel, tooltip, highlightEl;
```

### 3. React Component Name Detection (no DevTools needed)

```js
function getReactComponentName(el) {
  const fiberKey = Object.keys(el).find(k =>
    k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
  );
  if (!fiberKey) return null;
  let fiber = el[fiberKey];
  let depth = 0;
  while (fiber && depth < 20) {
    if (fiber.type && typeof fiber.type === 'function' && fiber.type.name) {
      const name = fiber.type.name;
      if (name && name !== 'div' && name !== 'span' && !/^[a-z]/.test(name)) return name;
    }
    if (fiber.type && fiber.type.displayName) return fiber.type.displayName;
    fiber = fiber.return;
    depth++;
  }
  return null;
}
```

### 4. Selector Priority (CSS)

```js
function getCssSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  // 1. Best data-* test attr
  const dataAttr = getBestDataAttr(el);
  if (dataAttr) return `[${dataAttr.attr}="${CSS.escape(dataAttr.value)}"]`;
  // 2. Non-generated ID (skip radix-*, :r0:, ng-*, mat-*, cdk-*)
  const GEN_ID = /^radix-|^:r[0-9a-z]+:|^ng-|^mat-|^cdk-|^[0-9]+$/;
  if (el.id && !GEN_ID.test(el.id)) {
    const esc = '#' + CSS.escape(el.id);
    try { if (document.querySelectorAll(esc).length === 1) return esc; } catch(e) {}
  }
  // 3. name attribute
  const name = el.getAttribute('name');
  if (name) {
    const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch(e) {}
  }
  // 4. aria-label
  const aria = el.getAttribute('aria-label');
  if (aria) {
    const sel = `[aria-label="${CSS.escape(aria)}"]`;
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch(e) {}
  }
  // 5. Fallback: nth-of-type path (max 4 levels)
  const parts = [];
  let current = el;
  while (current && current !== document.body && current.nodeType === 1) {
    let selector = current.tagName.toLowerCase();
    const levelData = getBestDataAttr(current);
    if (levelData) { parts.unshift(`[${levelData.attr}="${CSS.escape(levelData.value)}"]`); break; }
    if (current.id && !GEN_ID.test(current.id)) { parts.unshift('#' + CSS.escape(current.id)); break; }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
      if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(selector);
    current = current.parentElement;
    if (parts.length >= 4) break;
  }
  return parts.join(' > ');
}
```

### 5. XPath Priority

```js
function getXPath(el) {
  if (!el || el.nodeType !== 1) return '';
  const GEN_ID = /^radix-|^:r[0-9a-z]+:|^ng-|^mat-|^cdk-/;
  const dataAttr = getBestDataAttr(el);
  if (dataAttr) return `//*[@${dataAttr.attr}="${dataAttr.value}"]`;
  if (el.id && !GEN_ID.test(el.id)) return `//*[@id="${el.id}"]`;
  if (el.getAttribute('aria-label')) return `//*[@aria-label="${el.getAttribute('aria-label')}"]`;
  if (el.getAttribute('name')) return `//${el.tagName.toLowerCase()}[@name="${el.getAttribute('name')}"]`;
  // Fallback positional path
  const parts = [];
  let current = el;
  while (current && current.nodeType === 1 && current !== document.documentElement) {
    let tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
      if (siblings.length > 1) tag += `[${siblings.indexOf(current) + 1}]`;
    }
    parts.unshift(tag);
    current = current.parentElement;
  }
  return '/' + parts.join('/');
}
```

### 6. Code Generation

```js
function generateCodeForNode(node) {
  const { framework, language, selectorType } = state.options;
  const el = node.el;
  const dataAttr = node.attrs.dataTestId; // { attr, value } object
  const cssVal = node.cssSelector;
  const xpVal = node.xpath;
  const varName = node.reactName
    ? toCamelCase(node.reactName)
    : dataAttr ? toCamelCase(dataAttr.value)
    : toCamelCase(node.attrs.ariaLabel || node.attrs.name || node.tag || 'element');

  if (framework === 'playwright') {
    let locator;
    if (dataAttr)                locator = `page.getByTestId("${dataAttr.value}")`;
    else if (node.attrs.ariaLabel) locator = `page.getByRole("${node.attrs.role || node.tag}", { name: "${node.attrs.ariaLabel}" })`;
    else if (selectorType === 'xpath') locator = `page.locator("xpath=${xpVal}")`;
    else                         locator = `page.locator("${cssVal}")`;
    return language === 'java'
      ? `Locator ${varName} = ${locator};`
      : `${varName} = ${locator}`;
  }

  if (framework === 'selenium') {
    const byVal = selectorType === 'xpath'
      ? (language === 'java' ? `By.xpath("${xpVal}")` : `By.XPATH, "${xpVal}"`)
      : (language === 'java' ? `By.cssSelector("${cssVal}")` : `By.CSS_SELECTOR, "${cssVal}"`);
    return language === 'java'
      ? `WebElement ${varName} = driver.findElement(${byVal});`
      : `${varName} = driver.find_element(${byVal})`;
  }

  if (framework === 'cypress') {
    if (dataAttr) return `cy.get('[${dataAttr.attr}="${dataAttr.value}"]')`;
    if (selectorType === 'xpath') return `cy.xpath('${xpVal}')`;
    return `cy.get('${cssVal}')`;
  }
  return '';
}
```

### 7. Hover Mode — Exact Logic

```js
let hoverTarget = null;

// Walk UP from raw hovered element to find the best meaningful target.
// Stops at option/li/menuitem so we don't overshoot into container divs.
function resolveHoverTarget(raw) {
  if (!raw) return raw;
  const tag  = raw.tagName.toLowerCase();
  const role = raw.getAttribute('role') || '';
  const STOP_ROLES = new Set(['option','menuitem','menuitemcheckbox','menuitemradio','treeitem','tab']);
  const STOP_TAGS  = new Set(['option','li','select','input','textarea','button','a']);
  if (getBestDataAttr(raw))    return raw;
  if (STOP_ROLES.has(role))    return raw;
  if (STOP_TAGS.has(tag))      return raw;
  let cur = raw.parentElement;
  for (let i = 0; i < 5; i++) {
    if (!cur || cur === document.body) break;
    const ctag  = cur.tagName.toLowerCase();
    const crole = cur.getAttribute('role') || '';
    if (getBestDataAttr(cur))        return cur;
    if (STOP_ROLES.has(crole))       return cur;
    if (['button','a','select'].includes(ctag)) return cur;
    cur = cur.parentElement;
  }
  return raw;
}

function onHoverInspect(e) {
  const raw = e.target;
  if (panel   && panel.contains(raw)) return;
  if (tooltip && tooltip.contains(raw)) return;
  const el = resolveHoverTarget(raw);
  hoverTarget = el;
  highlightElement(el);
  updateTooltip(el, el.tagName.toLowerCase(), getReactComponentName(el), getCssSelector(el), e.clientX, e.clientY);
}

function onHoverClick(e) {
  if (panel   && panel.contains(e.target)) return;
  if (tooltip && tooltip.contains(e.target)) return;
  if (!hoverTarget) return;

  const el   = hoverTarget;
  const tag  = el.tagName.toLowerCase();
  const role = el.getAttribute('role') || '';

  // Dropdown triggers: capture them BUT let click through so dropdown opens
  const isDropdown = tag === 'select'
    || el.getAttribute('aria-haspopup')
    || role === 'combobox'
    || el.getAttribute('aria-expanded') !== null;

  if (!isDropdown) {
    e.preventDefault();   // stops link navigation and form submit
    e.stopPropagation();
  }

  // Build node and add to selected list
  const node = {
    el, tag,
    id: el.id || null,
    classes: Array.from(el.classList).slice(0, 3),
    reactName: getReactComponentName(el),
    isShadowHost: !!el.shadowRoot,
    shadowDepth: 0,
    interactive: isInteractive(el),
    text: el.textContent?.trim().slice(0, 50) || '',
    attrs: {
      type: el.getAttribute('type'),
      role: el.getAttribute('role'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      dataTestId: getBestDataAttr(el),  // returns { attr, value } object
      name: el.getAttribute('name'),
      href: tag === 'a' ? el.getAttribute('href')?.slice(0, 40) : null,
    },
    cssSelector: getCssSelector(el),
    xpath: getXPath(el),
    children: [],
  };
  addToSelected(node);
  setStatus(`Added <${tag}> to list`, 'active');
}
```

### 8. Shadow DOM Traversal

Recursively walk DOM. For each element, also walk `el.shadowRoot.children` if `shadowDepth < maxDepth`. Start with `maxDepth=1`, auto-retry with `maxDepth=2` if scan finds 0 elements.

### 9. Panel HTML Structure

The floating panel (`position:fixed, top:20px, right:20px, width:420px, max-height:90vh, z-index:2147483647`) injected into `document.body` contains:

**Header** (draggable): logo `🔍` + title + close `✕` button

**Body** (scrollable, flex column, gap 10px): sections for:
1. Element Scope checkboxes: `Interactive Only` (default) | `All Elements`
2. Framework checkboxes: `Playwright` (default) | `Selenium` | `Cypress`
3. Language checkboxes: `Java` (default) | `Python`
4. Selector Type checkboxes: `CSS` (default) | `XPath` | `Both`
5. Action row: `⚡ Scan Page` (primary) | `🖱 Hover Mode` (secondary, turns green when active)
6. Search input: placeholder "🔍  Search elements..."
7. Tree container: collapsible DOM tree
8. Selected Elements section (hidden until elements added): shows cards with CSS/XPath rows + generated code, each with individual Copy buttons. Export checkboxes JSON/CSV + Export button + clear button.

**Status bar**: dot indicator + status text (left) + "Depth: L1/L2" (right)

All checkboxes are radio-style (only one per group active). Clicking a label sets `state.options[group] = value` and re-renders.

### 10. Tree Node Display

Each node shows: `icon <tag> ReactName #id .class [aria-label] [testid badge] [shadow badge] text-preview`
- Pink `#f472b6` for tag names
- Sky blue `#38bdf8` for React component names  
- Slate `#94a3b8` for attrs
- Teal `#6ee7b7` italic for text preview
- `+` button appears on hover, adds to Selected Elements

### 11. Selected Element Card

Each card shows:
- Tag + badges (INTERACTIVE green, REACT blue, SHADOW amber)
- CSS row: `[CSS]` pill + selector value + `[Copy]` button (copies CSS only)
- XPath row (if xpath/both selected): `[XPath]` pill + value + `[Copy]` button (copies XPath only)
- `GENERATED CODE` label + code block + `[Copy]` button (copies code only)
- `✕` remove button top-right

### 12. Init/Registration

```js
function init() {
  buildPanel();
  state.panelVisible = true;
  window.__elementInspectorPanel = {
    show: () => { panel.style.display = 'flex'; state.panelVisible = true; },
    hide: () => { panel.style.display = 'none'; state.panelVisible = false; disableHoverMode(); },
  };
}
window.addEventListener('EIP_INIT', init);
window.__EIP_INIT = init;
```

---

## overlay.css — Key Styles

```css
/* Panel */
#eip-panel {
  position: fixed; top: 20px; right: 20px;
  width: 420px; max-height: 90vh;
  background: #0f1117;
  border: 1px solid #2d3748;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.2);
  z-index: 2147483647;
  font-family: 'Segoe UI', -apple-system, sans-serif;
  font-size: 13px; color: #e2e8f0;
  display: flex; flex-direction: column; overflow: hidden;
}

/* Header */
#eip-header {
  background: linear-gradient(135deg, #1a1f2e, #151926);
  padding: 12px 14px;
  display: flex; align-items: center; gap: 8px;
  cursor: grab; border-bottom: 1px solid #2d3748;
}
#eip-logo {
  width: 26px; height: 26px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 6px; font-size: 13px;
}
#eip-close {
  width: 22px; height: 22px; background: #2d3748;
  border: none; border-radius: 50%; color: #94a3b8;
}
#eip-close:hover { background: #ef4444; color: white; }

/* Sections */
.eip-section { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 8px; padding: 10px 12px; }
.eip-section-title { font-size: 10px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }

/* Checkbox labels (radio-style) */
.eip-checkbox-label { display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 4px 8px; border-radius: 5px; border: 1px solid #2d3748; background: #0f1117; font-size: 11px; color: #94a3b8; }
.eip-checkbox-label.checked { border-color: #6366f1; background: rgba(99,102,241,0.15); color: #a5b4fc; }
.eip-checkbox-label input[type="checkbox"] { display: none; }
.eip-dot { width: 8px; height: 8px; border-radius: 2px; border: 1.5px solid #4b5563; }
.eip-checkbox-label.checked .eip-dot { background: #6366f1; border-color: #6366f1; }

/* Buttons */
.eip-btn { flex: 1; padding: 8px 10px; border: none; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; }
.eip-btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; }
.eip-btn-secondary { background: #1e2433; color: #94a3b8; border: 1px solid #2d3748; }
.eip-btn-active { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid #10b981; }

/* Tree */
.eip-tree-tag { color: #f472b6; font-weight: 600; }
.eip-tree-react { color: #38bdf8; font-size: 10px; font-weight: 600; }
.eip-tree-attr { color: #94a3b8; }
.eip-tree-text { color: #6ee7b7; font-size: 10px; font-style: italic; }
.eip-tree-shadow-badge { font-size: 9px; background: rgba(251,191,36,0.15); color: #fbbf24; border-radius: 3px; padding: 0 4px; }
.eip-tree-add-btn { opacity: 0; background: #6366f1; border: none; border-radius: 3px; color: white; font-size: 10px; cursor: pointer; }
.eip-tree-item:hover .eip-tree-add-btn { opacity: 1; }
.eip-tree-children.collapsed { display: none; }
.eip-tree-toggle.open { transform: rotate(90deg); }

/* Selector rows */
.eip-selector-row { display: flex; align-items: flex-start; gap: 5px; background: #0a0d14; border: 1px solid #1e2433; border-radius: 5px; padding: 5px 7px; margin-bottom: 4px; }
.eip-selector-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #6366f1; background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.25); border-radius: 3px; padding: 1px 5px; flex-shrink: 0; }
.eip-selector-value { font-family: 'Consolas', monospace; font-size: 10px; color: #a5b4fc; flex: 1; word-break: break-all; }
.eip-copy-inline { background: #1e2433; border: 1px solid #2d3748; border-radius: 3px; color: #64748b; font-size: 9px; padding: 2px 7px; cursor: pointer; }
.eip-copy-inline:hover { background: #6366f1; color: white; }

/* Code block */
.eip-code-block { font-family: 'Consolas', monospace; font-size: 10px; color: #6ee7b7; background: #0a0d14; padding: 4px 6px; border-radius: 4px; border: 1px solid #1e2433; position: relative; word-break: break-all; }
.eip-code-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #10b981; margin-bottom: 4px; letter-spacing: 0.07em; }
.eip-copy-btn { position: absolute; top: 3px; right: 3px; background: #2d3748; border: none; border-radius: 3px; color: #94a3b8; font-size: 9px; padding: 2px 5px; cursor: pointer; }
.eip-copy-btn:hover { background: #6366f1; color: white; }

/* Badges */
.eip-badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
.eip-badge-react { background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); }
.eip-badge-shadow { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
.eip-badge-interactive { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }

/* Tooltip */
#eip-tooltip { position: fixed; z-index: 2147483647; background: #0f1117; border: 1px solid #6366f1; border-radius: 8px; padding: 8px 10px; font-family: 'Segoe UI', sans-serif; font-size: 11px; max-width: 300px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); pointer-events: none; }
.eip-tt-tag { color: #f472b6; font-weight: 700; margin-bottom: 4px; }
.eip-tt-selector { font-family: monospace; color: #a5b4fc; font-size: 10px; word-break: break-all; }
.eip-tt-hint { color: #4b5563; font-size: 10px; margin-top: 4px; font-style: italic; }

/* Page highlight overlay */
.eip-highlight-overlay { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #6366f1; background: rgba(99,102,241,0.1); border-radius: 2px; transition: all 0.1s; }

/* Status bar */
.eip-status-bar { background: #0f1117; border-top: 1px solid #2d3748; padding: 6px 12px; font-size: 10px; color: #4b5563; display: flex; justify-content: space-between; flex-shrink: 0; }
.eip-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #4b5563; display: inline-block; margin-right: 5px; }
.eip-status-dot.active { background: #10b981; box-shadow: 0 0 4px #10b981; }
.eip-status-dot.hover { background: #f59e0b; box-shadow: 0 0 4px #f59e0b; }

/* Search */
.eip-search { width: 100%; background: #0f1117; border: 1px solid #2d3748; border-radius: 6px; padding: 6px 10px; color: #e2e8f0; font-size: 11px; outline: none; }
.eip-search:focus { border-color: #6366f1; }

/* Scrollbars */
#eip-body::-webkit-scrollbar { width: 5px; }
#eip-body::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 3px; }

/* Spinner */
.eip-spinner { width: 14px; height: 14px; border: 2px solid #2d3748; border-top-color: #6366f1; border-radius: 50%; animation: eip-spin 0.7s linear infinite; }
@keyframes eip-spin { to { transform: rotate(360deg); } }
```

---

## Icons

Generate PNG icons (16×16, 48×48, 128×128) programmatically using Python PIL:
- Indigo rounded square background `(99, 102, 241)`
- White magnifier circle with handle
- Save to `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

---

## CRITICAL: Exact Panel HTML — Copy This Verbatim

The panel is injected into `document.body` as a `div#eip-panel`. The innerHTML must be **exactly** this structure. Do NOT add a settings gear, moon icon, collapsible sections, or sidebar chrome. It is a plain floating panel:

```html
<div id="eip-header">
  <div id="eip-logo">🔍</div>
  <div id="eip-title">Element Inspector Pro</div>
  <button id="eip-close" title="Close">✕</button>
</div>

<div id="eip-body">

  <!-- ELEMENT SCOPE -->
  <div class="eip-section">
    <div class="eip-section-title">Element Scope</div>
    <div class="eip-checkbox-group">
      <label class="eip-checkbox-label checked" data-group="scope" data-value="interactive">
        <input type="checkbox"> <span class="eip-dot"></span> Interactive Only
      </label>
      <label class="eip-checkbox-label" data-group="scope" data-value="all">
        <input type="checkbox"> <span class="eip-dot"></span> All Elements
      </label>
    </div>
  </div>

  <!-- FRAMEWORK -->
  <div class="eip-section">
    <div class="eip-section-title">Framework</div>
    <div class="eip-checkbox-group">
      <label class="eip-checkbox-label checked" data-group="framework" data-value="playwright">
        <input type="checkbox"> <span class="eip-dot"></span> Playwright
      </label>
      <label class="eip-checkbox-label" data-group="framework" data-value="selenium">
        <input type="checkbox"> <span class="eip-dot"></span> Selenium
      </label>
      <label class="eip-checkbox-label" data-group="framework" data-value="cypress">
        <input type="checkbox"> <span class="eip-dot"></span> Cypress
      </label>
    </div>
  </div>

  <!-- LANGUAGE -->
  <div class="eip-section">
    <div class="eip-section-title">Language</div>
    <div class="eip-checkbox-group">
      <label class="eip-checkbox-label checked" data-group="language" data-value="java">
        <input type="checkbox"> <span class="eip-dot"></span> Java
      </label>
      <label class="eip-checkbox-label" data-group="language" data-value="python">
        <input type="checkbox"> <span class="eip-dot"></span> Python
      </label>
    </div>
  </div>

  <!-- SELECTOR TYPE -->
  <div class="eip-section">
    <div class="eip-section-title">Selector Type</div>
    <div class="eip-checkbox-group">
      <label class="eip-checkbox-label checked" data-group="selectorType" data-value="css">
        <input type="checkbox"> <span class="eip-dot"></span> CSS
      </label>
      <label class="eip-checkbox-label" data-group="selectorType" data-value="xpath">
        <input type="checkbox"> <span class="eip-dot"></span> XPath
      </label>
      <label class="eip-checkbox-label" data-group="selectorType" data-value="both">
        <input type="checkbox"> <span class="eip-dot"></span> Both
      </label>
    </div>
  </div>

  <!-- ACTION BUTTONS — side by side equal width -->
  <div class="eip-action-row">
    <button class="eip-btn eip-btn-primary" id="eip-scan-btn">⚡ Scan Page</button>
    <button class="eip-btn eip-btn-secondary" id="eip-hover-btn">🖱 Hover Mode</button>
  </div>

  <!-- SEARCH -->
  <input class="eip-search" id="eip-search" placeholder="🔍  Search elements..." />

  <!-- TREE VIEW — populated after scan -->
  <div id="eip-tree-container">
    <div class="eip-empty">Scan the page or use hover mode to inspect elements</div>
  </div>

  <!-- SELECTED ELEMENTS — hidden until elements added -->
  <div id="eip-selected-section" style="display:none">
    <div class="eip-section-title" style="color:#10b981;margin-bottom:6px">
      Selected Elements <span class="eip-count-badge" id="eip-sel-count">0</span>
    </div>
    <div id="eip-selected-list"></div>
    <div class="eip-action-row" style="margin-top:8px">
      <label class="eip-checkbox-label checked" data-group="exportFormat" data-value="json">
        <input type="checkbox"> <span class="eip-dot"></span> JSON
      </label>
      <label class="eip-checkbox-label" data-group="exportFormat" data-value="csv">
        <input type="checkbox"> <span class="eip-dot"></span> CSV
      </label>
      <button class="eip-btn eip-btn-secondary" id="eip-export-btn" style="flex:2">⬇ Export</button>
      <button class="eip-btn eip-btn-secondary" id="eip-clear-btn">🗑</button>
    </div>
  </div>

</div>

<!-- STATUS BAR — always visible at bottom -->
<div class="eip-status-bar">
  <div><span class="eip-status-dot" id="eip-status-dot"></span><span id="eip-status-text">Ready</span></div>
  <div>Depth: <span id="eip-depth-badge">L1</span></div>
</div>
```

### CRITICAL UI RULES — Do NOT violate these:
1. NO settings gear icon. NO moon/theme toggle. NO collapsible configuration section.
2. NO sidebar. Panel is `position:fixed` injected directly onto the page, NOT inside Chrome's sidebar API.
3. Checkbox labels use the `.eip-checkbox-label` pill style with a small square dot indicator — NOT large button toggles.
4. `eip-section-title` is uppercase, 10px, indigo `#6366f1`, letter-spaced — NOT a large heading.
5. All four option sections (Scope, Framework, Language, Selector Type) are always visible — NOT collapsible.
6. Tree container `#eip-tree-container` shows scan results inline inside the panel — NOT in a separate tab.
7. Selected elements appear below the tree inside the same scrollable body — NOT in a separate section outside the panel.
8. The action row uses `display:flex; gap:6px` with `flex:1` on each button — buttons are EQUAL width side by side.
9. `eip-checkbox-group` uses `display:flex; flex-wrap:wrap; gap:6px` — chips wrap naturally, NOT stacked vertically.
10. The panel is draggable by the header using mousedown/mousemove on `document`.

### Exact CSS for checkbox pill style:
```css
.eip-checkbox-group { display: flex; flex-wrap: wrap; gap: 6px; }

.eip-checkbox-label {
  display: flex; align-items: center; gap: 5px;
  cursor: pointer; padding: 4px 8px;
  border-radius: 5px; border: 1px solid #2d3748;
  background: #0f1117; font-size: 11px; color: #94a3b8;
  transition: all 0.15s; white-space: nowrap;
}
.eip-checkbox-label:hover { border-color: #6366f1; color: #e2e8f0; }
.eip-checkbox-label input[type="checkbox"] { display: none; }
.eip-checkbox-label.checked {
  border-color: #6366f1;
  background: rgba(99,102,241,0.15);
  color: #a5b4fc;
}
.eip-dot {
  width: 8px; height: 8px;
  border-radius: 2px; border: 1.5px solid #4b5563;
  flex-shrink: 0; transition: all 0.15s;
}
.eip-checkbox-label.checked .eip-dot {
  background: #6366f1; border-color: #6366f1;
}

.eip-action-row { display: flex; gap: 6px; }
.eip-btn { flex: 1; padding: 8px 10px; border: none; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.2s; }
.eip-btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; }
.eip-btn-secondary { background: #1e2433; color: #94a3b8; border: 1px solid #2d3748; }
.eip-btn-active { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid #10b981; }
```
