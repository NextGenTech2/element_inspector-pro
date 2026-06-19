(function() {
  console.log('Content script injected');
  if (window.__EIP_LOADED) {
    if (window.__elementInspectorPanel) {
      window.__elementInspectorPanel.style.display = 'flex';
      console.log('Panel displayed');
    }
    return;
  }
  window.__EIP_LOADED = true;

  // State
  let state = {
    hoverMode: false,
    scope: 'interactive', // interactive, all
    framework: 'playwright', // playwright, selenium, cypress
    language: 'java', // java, python
    selectorType: 'css', // css, xpath, both
    selectedElements: [],
    lastScanned: 0,
    depthLevel: 1
  };

  const UI = {
    container: null,
    shadowRoot: null,
    panel: null,
    highlightBox: null,
    tooltip: null,
    treeContainer: null,
    selectedContainer: null
  };

  function initUI() {
    // Inject overlay CSS to document head for highlight box and tooltip
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('overlay.css');
    document.head.appendChild(link);

    UI.container = document.createElement('div');
    UI.container.style.position = 'fixed';
    UI.container.style.top = '0';
    UI.container.style.left = '0';
    UI.container.style.width = '100%';
    UI.container.style.height = '100%';
    UI.container.style.zIndex = '2147483647';
    UI.container.style.display = 'flex';
    UI.container.style.pointerEvents = 'none'; // allow clicks to pass through except panel
    UI.shadowRoot = UI.container.attachShadow({ mode: 'open' });

    UI.panel = document.createElement('div');
    UI.panel.id = 'eip-panel';
    UI.panel.style.position = 'fixed';
    UI.panel.style.top = '10px';
    UI.panel.style.right = '10px'; // align to right
    UI.panel.style.pointerEvents = 'auto'; // enable interaction
    window.__elementInspectorPanel = UI.container; // for re-init
    
    const shadowLink = document.createElement('link');
    shadowLink.rel = 'stylesheet';
    shadowLink.href = chrome.runtime.getURL('overlay.css');
    UI.shadowRoot.appendChild(shadowLink);
    
    UI.panel.innerHTML = `
      <div id="eip-header">
        <div id="eip-logo">🔍</div>
        <div id="eip-title">Element Inspector Pro</div>
        <button id="eip-theme-toggle" title="Toggle Dark/Light">🌙</button>
        <button id="eip-close" title="Close">✕</button>
      </div>
      
      <div id="eip-body">
      
        <!-- ACCORDION SETTINGS -->
        <div class="eip-accordion">
          <div class="eip-accordion-header" id="eip-settings-toggle">
            <span>⚙️ Configuration Settings</span>
            <span class="eip-accordion-icon" id="eip-settings-icon">▼</span>
          </div>
          <div class="eip-accordion-content" id="eip-settings-content" style="display: none;">
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
    `;

    UI.shadowRoot.appendChild(UI.panel);
    document.body.appendChild(UI.container);

    // Overlay Elements (outside shadow DOM)
    UI.highlightBox = document.createElement('div');
    UI.highlightBox.className = 'eip-highlight-box';
    UI.highlightBox.style.display = 'none';
    document.body.appendChild(UI.highlightBox);

    UI.tooltip = document.createElement('div');
    UI.tooltip.id = 'eip-tooltip';
    UI.tooltip.style.display = 'none';
    document.body.appendChild(UI.tooltip);

    UI.treeContainer = UI.panel.querySelector('#eip-tree-container');
    UI.selectedContainer = UI.panel.querySelector('#eip-selected-list');

    setupEvents();
    makeDraggable();
  }

  function setupEvents() {
    // Accordion Toggle
    const settingsToggle = UI.panel.querySelector('#eip-settings-toggle');
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        const content = UI.panel.querySelector('#eip-settings-content');
        const icon = UI.panel.querySelector('#eip-settings-icon');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.style.transform = 'rotate(0deg)';
        } else {
          content.style.display = 'none';
          icon.style.transform = 'rotate(-90deg)';
        }
      };
    }

    // Close
    UI.panel.querySelector('#eip-close').onclick = () => {
      UI.container.style.display = 'none';
      if (state.hoverMode) toggleHoverMode();
    };

    // Theme toggle
    const themeToggle = UI.panel.querySelector('#eip-theme-toggle');
    if (themeToggle) {
      themeToggle.onclick = () => {
        const currentTheme = UI.container.getAttribute('data-theme');
        if (currentTheme === 'light') {
          UI.container.removeAttribute('data-theme');
          document.documentElement.removeAttribute('data-theme');
          themeToggle.innerHTML = '🌙';
        } else {
          UI.container.setAttribute('data-theme', 'light');
          document.documentElement.setAttribute('data-theme', 'light');
          themeToggle.innerHTML = '☀️';
        }
      };
    }

    // Checkboxes (pill style)
    UI.panel.querySelectorAll('.eip-checkbox-label').forEach(label => {
      label.onclick = (e) => {
        e.preventDefault(); // Prevent default checkbox behavior as we handle it
        const group = label.dataset.group;
        const value = label.dataset.value;
        
        if (group === 'scope') state.scope = value;
        if (group === 'framework') state.framework = value;
        if (group === 'language') state.language = value;
        if (group === 'selectorType') state.selectorType = value;
        if (group === 'exportFormat') state.exportFormat = value; // assuming state.exportFormat exists or we add it
        
        // Update UI
        UI.panel.querySelectorAll(`.eip-checkbox-label[data-group="${group}"]`).forEach(l => {
          l.classList.remove('checked');
        });
        label.classList.add('checked');
        
        if (['framework', 'language', 'selectorType'].includes(group)) {
          if (typeof renderSelected === 'function') renderSelected(); // re-render selected elements with new framework/language
        }
      };
    });

    // Hover Mode
    UI.panel.querySelector('#eip-hover-btn').onclick = toggleHoverMode;

    // Scan
    UI.panel.querySelector('#eip-scan-btn').onclick = scanPage;

    // Search
    UI.panel.querySelector('#eip-search').oninput = (e) => {
      if (typeof filterTree === 'function') filterTree(e.target.value);
    };

    // Export
    UI.panel.querySelector('#eip-export-btn').onclick = exportData;

    // Clear Selected
    UI.panel.querySelector('#eip-clear-btn').onclick = () => {
      state.selectedElements = [];
      const container = UI.panel.querySelector('#eip-selected-list') || UI.panel.querySelector('#eip-selected-container');
      if (container) container.innerHTML = '';
      const count = UI.panel.querySelector('#eip-sel-count');
      if (count) count.innerText = '0';
      const section = UI.panel.querySelector('#eip-selected-section');
      if (section) section.style.display = 'none';
    };

    // Escape Key listener for hover mode
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.hoverMode) {
        toggleHoverMode();
      }
    });
  }

  function makeDraggable() {
    const header = UI.panel.querySelector('#eip-header');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.onmousedown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = UI.panel.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      // Convert right/bottom based positioning to left/top to avoid resize jumping
      UI.panel.style.right = 'auto';
      UI.panel.style.bottom = 'auto';
      UI.panel.style.left = initialX + 'px';
      UI.panel.style.top = initialY + 'px';
    };

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      UI.panel.style.left = (initialX + dx) + 'px';
      UI.panel.style.top = (initialY + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function shouldPreventClick(node) {
    let current = node;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.tagName === 'A') return true;
      if (current.tagName === 'FORM') return false;
      if (current.tagName === 'INPUT' && (current.type === 'submit' || current.type === 'image')) return true;
      if (current.tagName === 'BUTTON' && current.type === 'submit') return true;
      current = current.parentElement;
    }
    return false;
  }

  // --- Hover Mode Logic ---
  const HoverHandlers = {
    mouseover(e) {
      if (e.target === UI.container || UI.container.contains(e.target)) return;
      
      // Use composedPath to get the original element inside a shadow DOM.
      const path = e.composedPath();
      let el = null;
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node instanceof Element) {
          const candidate = getTargetElement(node);
          if (candidate) { el = candidate; break; }
        }
      }
      if (!el) return;

      const rect = el.getBoundingClientRect();
      UI.highlightBox.style.display = 'block';
      UI.highlightBox.style.top = rect.top + 'px';
      UI.highlightBox.style.left = rect.left + 'px';
      UI.highlightBox.style.width = rect.width + 'px';
      UI.highlightBox.style.height = rect.height + 'px';

      const tag = el.tagName.toLowerCase();
      const reactName = getReactComponentName(el);
      const selector = generateCSSSelector(el);
      
      UI.tooltip.style.display = 'block';
      UI.tooltip.innerHTML = `<div class="eip-tt-tag">&lt;${tag}&gt;</div>${reactName ? '<div class="eip-badge-react" style="display:inline-block;margin-bottom:4px;">'+reactName+'</div><br/>' : ''}<div class="eip-tt-selector">${selector}</div>`;
      
      const statusText = UI.panel.querySelector('#eip-status-text');
      if (statusText) statusText.innerText = 'Hovering...';
      const statusDot = UI.panel.querySelector('#eip-status-dot');
      if (statusDot) statusDot.className = 'eip-status-dot hover';

      let tooltipTop = rect.bottom + 5;
      let tooltipLeft = rect.left;
      if (tooltipTop + 50 > window.innerHeight) tooltipTop = rect.top - 50;
      UI.tooltip.style.top = tooltipTop + 'px';
      UI.tooltip.style.left = tooltipLeft + 'px';
    },
    mouseout(e) {
      UI.highlightBox.style.display = 'none';
      UI.tooltip.style.display = 'none';
    },
    pointerdown(e) {
      if (e.target === UI.container || UI.container.contains(e.target)) return;
      
      // Use composedPath() to get the original target even when it lives inside a shadow DOM.
      const path = e.composedPath();
      // Find the first element in the path that matches our interactive criteria.
      let el = null;
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node instanceof Element) {
          const candidate = getTargetElement(node);
          if (candidate) { el = candidate; break; }
        }
      }
      if (!el) return;

      try {
        addElementToSelected(el);
      } catch (err) {
        console.error("Element Inspector Pro: Error adding element", err);
      }
      
      // We explicitly DO NOT exit hover mode here.
      // We also DO NOT preventDefault on pointerdown, allowing modern UI libraries 
      // (like Radix dropdowns) to function naturally.
    },
    click(e) {
      if (e.target === UI.container || UI.container.contains(e.target)) return;
      // Prevent navigation only on elements that would cause a page change.
      if (shouldPreventClick(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  function toggleHoverMode() {
    state.hoverMode = !state.hoverMode;
    const btn = UI.panel.querySelector('#eip-hover-btn');
    if (state.hoverMode) {
      btn.classList.add('eip-btn-active');
      btn.innerHTML = 'Hover Active (Esc to exit)';
      document.addEventListener('mouseover', HoverHandlers.mouseover);
      document.addEventListener('mouseout', HoverHandlers.mouseout);
      document.addEventListener('pointerdown', HoverHandlers.pointerdown, true);
      document.addEventListener('click', HoverHandlers.click, true);
    } else {
      btn.classList.remove('eip-btn-active');
      btn.innerHTML = '🖱 Hover Mode';
      UI.highlightBox.style.display = 'none';
      UI.tooltip.style.display = 'none';
      document.removeEventListener('mouseover', HoverHandlers.mouseover);
      document.removeEventListener('mouseout', HoverHandlers.mouseout);
      document.removeEventListener('pointerdown', HoverHandlers.pointerdown, true);
      document.removeEventListener('click', HoverHandlers.click, true);
    }
  }

  function getTargetElement(node) {
    const interactiveTags = ['a', 'button', 'select', 'input', 'textarea', 'option', 'li', 'menuitem'];
    let current = node;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.tagName && interactiveTags.includes(current.tagName.toLowerCase())) return current;
      if (current.getAttribute && (current.getAttribute('role') === 'button' || current.getAttribute('role') === 'link')) return current;
      current = current.parentElement;
    }
    if (node && node.nodeType === 3) return node.parentElement;
    return node; // default to current hovered element if no interactive ancestor
  }

  function isInteractive(el) {
    const tags = ['button', 'a', 'input', 'select', 'textarea', 'option', 'summary'];
    if (tags.includes(el.tagName.toLowerCase())) return true;
    const role = el.getAttribute('role');
    if (role && ['button', 'link', 'checkbox', 'switch', 'menuitem', 'option', 'combobox', 'textbox'].includes(role)) return true;
    return false;
  }

  // --- React & Shadow DOM utils ---
  function getReactComponentName(node) {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    if (fiberKey) {
      let fiber = node[fiberKey];
      while (fiber) {
        if (typeof fiber.type === 'function' && fiber.type.name && fiber.type.name[0] === fiber.type.name[0].toUpperCase()) {
          return fiber.type.name;
        }
        fiber = fiber.return;
      }
    }
    return null;
  }

  // --- Locators Generation ---
  function getBestDataTestAttribute(el) {
    let bestScore = -1;
    let bestAttr = null;
    let bestValue = null;

    const skipPrefixes = ['data-state', 'data-orientation', 'data-disabled', 'data-open', 'data-radix', 'data-slot'];
    
    for (let attr of el.attributes) {
      if (attr.name.startsWith('data-')) {
        if (skipPrefixes.some(p => attr.name.startsWith(p))) continue;
        
        let score = 10;
        const name = attr.name.toLowerCase();
        if (name.includes('test')) score = 100;
        else if (name.includes('id') || name.includes('qa-id')) score = 80;
        else if (name.includes('cy') || name.includes('cypress')) score = 75;
        else if (name.includes('qa')) score = 70;
        else if (name.match(/auto|e2e|pw|wdio|selenium/)) score = 65;
        else if (name.match(/hook|component|ref|handle/)) score = 50;

        if (score > bestScore) {
          bestScore = score;
          bestAttr = attr.name;
          bestValue = attr.value;
        }
      }
    }
    return bestAttr ? { attr: bestAttr, value: bestValue } : null;
  }

  function isDynamicId(id) {
    return /^radix-/.test(id) || /^:r\w+:/.test(id) || /^ng-/.test(id) || /^mat-/.test(id) || /^cdk-/.test(id) || /\d{3,}/.test(id);
  }

  function isUtilityClass(cls) {
    const tailwindPrefixes = /^(flex|grid|block|hidden|p-|m-|text-|bg-|border-|rounded-|w-|h-|hover:|focus:|dark:|sm:|md:|lg:|xl:|2xl:|relative|absolute|fixed|inline|items-|justify-|transition-|duration-|ease-)/;
    return tailwindPrefixes.test(cls);
  }

  function generateCSSSelector(el) {
    if (el.tagName === 'BODY' || el.tagName === 'HTML') return el.tagName.toLowerCase();

    // 1. Data test id
    const dataTest = getBestDataTestAttribute(el);
    if (dataTest) return `[${dataTest.attr}="${dataTest.value}"]`;

    // 2. href for links
    if (el.tagName === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) {
      return `a[href="${el.getAttribute('href')}"]`;
    }

    // 3. aria-label
    if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;

    // 4. ID
    if (el.id && !isDynamicId(el.id)) return `#${CSS.escape(el.id)}`;

    // 5. name
    if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;

    // 6. placeholder
    if (el.getAttribute('placeholder')) return `[placeholder="${el.getAttribute('placeholder')}"]`;

    // 7. type attribute for inputs
    if (el.tagName === 'INPUT' && el.getAttribute('type') && ['checkbox', 'radio', 'text'].includes(el.getAttribute('type'))) {
        const type = el.getAttribute('type');
        if (el.classList.length > 0) {
            const meaningfulClasses = Array.from(el.classList).filter(c => !isUtilityClass(c));
            if (meaningfulClasses.length > 0) return `input[type="${type}"].${CSS.escape(meaningfulClasses[0])}`;
        }
    }

    // 8. meaningful class
    if (el.classList.length > 0) {
      const meaningfulClasses = Array.from(el.classList).filter(c => !isUtilityClass(c));
      if (meaningfulClasses.length > 0) {
        return `${el.tagName.toLowerCase()}.${CSS.escape(meaningfulClasses[0])}`;
      }
    }

    // 9. nth-of-type
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length === 1) return `${generateCSSSelector(parent)} > ${tag}`;
      const index = siblings.indexOf(el) + 1;
      return `${generateCSSSelector(parent)} > ${tag}:nth-of-type(${index})`;
    }

    return tag;
  }

  function generateXPath(el) {
    if (el.tagName === 'BODY') return '/html/body';
    if (el.tagName === 'HTML') return '/html';
    
    const tag = el.tagName.toLowerCase();

    // 1. Data test id
    const dataTest = getBestDataTestAttribute(el);
    if (dataTest) return `//${tag}[@${dataTest.attr}='${dataTest.value}']`;
    
    // 2. href for links
    if (el.tagName === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) {
      return `//a[@href='${el.getAttribute('href')}']`;
    }

    // 3. aria-label
    if (el.getAttribute('aria-label')) return `//${tag}[@aria-label='${el.getAttribute('aria-label')}']`;

    // 4. ID
    if (el.id && !isDynamicId(el.id)) return `//*[@id='${el.id}']`;

    // 5. name
    if (el.getAttribute('name')) return `//${tag}[@name='${el.getAttribute('name')}']`;

    // 6. placeholder
    if (el.getAttribute('placeholder')) return `//${tag}[@placeholder='${el.getAttribute('placeholder')}']`;

    // 7. type attribute for inputs
    if (el.tagName === 'INPUT' && el.getAttribute('type') && ['checkbox', 'radio', 'text'].includes(el.getAttribute('type'))) {
        const type = el.getAttribute('type');
        if (el.classList.length > 0) {
            const meaningfulClasses = Array.from(el.classList).filter(c => !isUtilityClass(c));
            if (meaningfulClasses.length > 0) return `//input[@type='${type}' and contains(concat(' ', normalize-space(@class), ' '), ' ${meaningfulClasses[0]} ')]`;
        }
    }

    // 8. meaningful class
    if (el.classList.length > 0) {
      const meaningfulClasses = Array.from(el.classList).filter(c => !isUtilityClass(c));
      if (meaningfulClasses.length > 0) {
        return `//${tag}[contains(concat(' ', normalize-space(@class), ' '), ' ${meaningfulClasses[0]} ')]`;
      }
    }

    // 9. Text matching (Very powerful in XPath for links and buttons)
    if (['BUTTON', 'A'].includes(el.tagName)) {
        const text = el.innerText ? el.innerText.trim() : '';
        if (text && text.length > 0 && text.length < 30 && !text.includes('\n') && !text.includes("'")) {
             return `//${tag}[normalize-space(text())='${text}']`;
        }
    }
    
    // 10. Fallback to absolute path
    let path = '';
    let current = el;
    while (current && current.tagName !== 'HTML') {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      const currentTag = current.tagName.toLowerCase();
      path = `/${currentTag}[${index}]${path}`;
      current = current.parentElement;
    }
    return `/html${path}`;
  }

  function generateVariableName(el) {
    const reactName = getReactComponentName(el);
    if (reactName) {
      return reactName.charAt(0).toLowerCase() + reactName.slice(1);
    }
    const dataTest = getBestDataTestAttribute(el);
    if (dataTest && dataTest.value) {
      const parts = dataTest.value.split(/[-_]/);
      return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    }
    const aria = el.getAttribute('aria-label');
    if (aria) {
      const parts = aria.split(/\s+/);
      return parts[0].toLowerCase() + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('').replace(/[^a-zA-Z0-9]/g, '');
    }
    return el.tagName.toLowerCase() + 'El';
  }

  function generateCode(el, css, xpath, shadowHostChain) {
    const framework = state.framework;
    const language = state.language;
    const selectorType = state.selectorType;
    
    const baseVarName = generateVariableName(el);
    const finalCss = shadowHostChain ? `${shadowHostChain} >> ${css}` : css;

    const buildPlaywright = (loc, suffix) => {
      const varName = baseVarName + suffix;
      if (language === 'java') {
        return 'Locator ' + varName + ' = page.locator("' + loc.replace(/"/g, '\\"') + '");';
      }
      const snakeVar = varName.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
      return snakeVar + ' = page.locator("' + loc.replace(/"/g, '\\"') + '")';
    };

    const buildSelenium = (loc, isXpath, suffix, shadowHostChain) => {
      const varName = baseVarName + suffix;
      if (language === 'java') {
        // For Java, use JavascriptExecutor if shadow DOM chain exists
        if (shadowHostChain) {
          const script = shadowHostChain.split('>>>').map((part, idx) => {
            const query = part.trim();
            if (idx === 0) return `document.querySelector('${query}')`;
            return `.shadowRoot.querySelector('${query}')`;
          }).join('') + `.shadowRoot.querySelector('${loc}')`;
          return 'WebElement ' + varName + ' = (WebElement) ((JavascriptExecutor)driver).executeScript("return ' + script.replace(/"/g, '\\"') + '");';
        }
        const byType = isXpath ? 'By.xpath' : 'By.cssSelector';
        return 'WebElement ' + varName + ' = driver.findElement(' + byType + '(\"' + loc.replace(/\"/g, '\\\\\"') + '\"));';
      } else {
        // Python Selenium
        if (shadowHostChain) {
          const scriptParts = shadowHostChain.split('>>>').map(part => `document.querySelector('${part.trim()}')`).join('.shadowRoot.querySelector(') + `.shadowRoot.querySelector('${loc}')`;
          const script = `return ${scriptParts}`;
          return varName + ' = driver.execute_script("""\n    ' + script + '\n""")';
        }
        const pyBy = isXpath ? 'By.XPATH' : 'By.CSS_SELECTOR';
        const snakeVar = varName.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
        return snakeVar + ' = driver.find_element(' + pyBy + ', \"' + loc.replace(/\"/g, '\\\\\"') + '\")';
      }
    };

    const buildCypress = (loc, isXpath) => {
      if (isXpath) return "cy.xpath('" + loc.replace(/'/g, "\\'") + "');";
      if (shadowHostChain) {
        const chain = shadowHostChain.split('>>>').join("').shadow().find('");
        return `cy.get('${chain}').shadow().find('${loc}');`;
      }
      return "cy.get('" + loc.replace(/'/g, "\\'") + "');";
    };

    const getCode = (type, suffix = '') => {
      const loc = type === 'xpath' ? xpath : finalCss;
      const isXpath = type === 'xpath';
      if (framework === 'playwright') return buildPlaywright(loc, suffix);
      if (framework === 'selenium') return buildSelenium(loc, isXpath, suffix, shadowHostChain);
      if (framework === 'cypress') return buildCypress(loc, isXpath);
      return '';
    };

    if (selectorType === 'both') {
      return getCode('css', 'Css') + '\n' + getCode('xpath', 'Xpath');
    } else {
      return getCode(selectorType);
    }
  }

  // --- Core Application Logic ---

  function scanPage() {
    state.lastScanned = Date.now();
    UI.treeContainer.innerHTML = '';
    const rootNodes = getDomNodes(document.body, 1);
    
    let nodesHtml = '';
    let count = 0;
    
    function buildTreeHTML(node) {
      if (state.scope === 'interactive' && !node.isInteractive) {
        let childHtml = '';
        if (node.children) node.children.forEach(c => childHtml += buildTreeHTML(c));
        return childHtml;
      }

      count++;
      
      let icon = '🔹';
      if (node.tag === 'a') {
        icon = '🔗';
      } else if (node.isInteractive) {
        icon = '🔘';
      }
      
      let html = `<div class="eip-tree-node ${node.depth === 1 ? 'root' : ''}">
        <div class="eip-tree-item" data-id="${node.id}">
          <span style="font-size:10px;margin-right:2px;display:inline-flex;align-items:center;">${icon}</span>
          <span class="eip-tree-tag">&lt;${node.tag}&gt;</span>
          ${node.reactName ? `<span class="eip-tree-react">${node.reactName}</span>` : ''}
          ${node.idAttribute ? `<span class="eip-tree-attr">#${node.idAttribute}</span>` : ''}
          ${node.classes && node.classes.length > 0 ? `<span class="eip-tree-attr">.${node.classes.join('.')}</span>` : ''}
          ${node.ariaLabel ? `<span class="eip-tree-attr">[aria-label="${node.ariaLabel}"]</span>` : ''}
          ${node.dataTest ? `<span class="eip-tree-shadow-badge" style="background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3);">${node.dataTest}</span>` : ''}
          ${node.isShadowHost ? `<span class="eip-tree-shadow-badge">SHADOW</span>` : ''}
          ${node.text ? `<span class="eip-tree-text">"${node.text}"</span>` : ''}
          <button class="eip-tree-add-btn" data-id="${node.id}">+</button>
        </div>`;
      
      if (node.children && node.children.length > 0) {
        node.children.forEach(c => {
          html += buildTreeHTML(c);
        });
      }
      html += `</div>`;
      return html;
    }

    rootNodes.forEach(rn => { nodesHtml += buildTreeHTML(rn); });
    UI.treeContainer.innerHTML = nodesHtml;
    UI.panel.querySelector('#eip-status-text').innerText = `Found ${count} elements`;
    UI.panel.querySelector('#eip-depth-badge').innerText = `L${state.depthLevel}`;

    // Attach tree events
    UI.treeContainer.querySelectorAll('.eip-tree-item').forEach(item => {
      item.onmouseover = (e) => {
        const id = item.getAttribute('data-id');
        const el = getElementByIdx(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          UI.highlightBox.style.display = 'block';
          UI.highlightBox.style.top = rect.top + window.scrollY + 'px';
          UI.highlightBox.style.left = rect.left + window.scrollX + 'px';
          UI.highlightBox.style.width = rect.width + 'px';
          UI.highlightBox.style.height = rect.height + 'px';
        }
      };
      item.onmouseout = () => { UI.highlightBox.style.display = 'none'; };
    });

    UI.treeContainer.querySelectorAll('.eip-tree-add-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const el = getElementByIdx(id);
        if (el) addElementToSelected(el);
      };
    });
  }

  const elementRegistry = new Map();
  let elementCounter = 0;

  function getDomNodes(rootEl, depth) {
    state.depthLevel = Math.max(state.depthLevel, depth);
    const nodes = [];
    const children = rootEl.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el === UI.container || UI.container.contains(el)) continue;
      if (el === UI.highlightBox || el === UI.tooltip) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT' || el.tagName === 'LINK') continue;

      const id = 'eip_' + (++elementCounter);
      elementRegistry.set(id, el);

      const isShadowHost = !!el.shadowRoot;
      const dataTest = getBestDataTestAttribute(el);
      
      let fallback = null;
      if (el.id && !isDynamicId(el.id)) {
        fallback = '#' + el.id;
      } else if (el.tagName === 'A' && el.getAttribute('href')) {
        fallback = 'href="' + el.getAttribute('href').replace(window.location.origin, '') + '"';
      } else if (['button', 'input'].includes(el.tagName.toLowerCase()) && el.classList.length > 0) {
        const meaningfulClasses = Array.from(el.classList).filter(c => !isUtilityClass(c));
        if (meaningfulClasses.length > 0) fallback = '.' + meaningfulClasses[0];
      } else if (el.innerText && el.innerText.trim().length > 0) {
        fallback = '"' + el.innerText.trim().substring(0, 15) + '..."';
      }

      const nodeInfo = {
        id: id,
        tag: el.tagName.toLowerCase(),
        reactName: getReactComponentName(el),
        isInteractive: isInteractive(el),
        isShadowHost: isShadowHost,
        dataTest: dataTest ? dataTest.attr + '=' + dataTest.value : null,
        idAttribute: el.id && !isDynamicId(el.id) ? el.id : null,
        classes: Array.from(el.classList).slice(0, 3),
        text: el.innerText ? el.innerText.trim().substring(0, 30).replace(/\n/g, ' ') : '',
        ariaLabel: el.getAttribute('aria-label') || null,
        fallbackLabel: fallback,
        depth: depth,
        children: []
      };

      // Traverse children
      nodeInfo.children = getDomNodes(el, depth);
      
      // Pierce shadow DOM
      if (isShadowHost && depth < 3) {
         nodeInfo.children = nodeInfo.children.concat(getDomNodes(el.shadowRoot, depth + 1));
      }

      nodes.push(nodeInfo);
    }
    return nodes;
  }

  function getElementByIdx(id) {
    return elementRegistry.get(id);
  }

  function addElementToSelected(el) {
    // Mark shadow status on the element for UI badges
    el.__eip_isShadow = el.getRootNode && el.getRootNode() instanceof ShadowRoot;

    // Check if element is already selected
    if (state.selectedElements.some(s => s.element === el)) return;

    // Build chain of shadow hosts (e.g., host1>>>host2) for code generation
    const shadowHostChain = (function(){
      const parts = [];
      let node = el;
      while (node) {
        if (node instanceof ShadowRoot) {
          const host = node.host;
          if (host) {
            parts.unshift(host.tagName.toLowerCase() + (host.id ? `#${host.id}` : ''));
            node = host;
          } else {
            break;
          }
        } else {
          node = node.parentNode;
        }
      }
      return parts.join('>>>');
    })();

    const data = {
      id: 'sel_' + Date.now() + Math.floor(Math.random() * 1000),
      element: el,
      tag: el.tagName.toLowerCase(),
      reactName: getReactComponentName(el),
      isInteractive: isInteractive(el),
      isShadowHost: !!el.shadowRoot,
      css: generateCSSSelector(el),
      xpath: generateXPath(el),
      options: el.tagName === 'SELECT' ? Array.from(el.options).map(o => ({text: o.text, value: o.value})) : [],
      isShadow: el.__eip_isShadow,
      shadowHostChain: shadowHostChain
    };

    state.selectedElements.push(data);
    renderSelected();
  }

  function removeSelected(id) {
    state.selectedElements = state.selectedElements.filter(s => s.id !== id);
    renderSelected();
  }

  function renderSelected() {
    UI.panel.querySelector('#eip-sel-count').innerText = state.selectedElements.length;
    UI.selectedContainer.innerHTML = '';
    const section = UI.panel.querySelector('#eip-selected-section');
    if (state.selectedElements.length > 0) {
      if (section) section.style.display = 'block';
    } else {
      if (section) section.style.display = 'none';
    }

    state.selectedElements.forEach(data => {
      const code = generateCode(data.element, data.css, data.xpath, data.shadowHostChain);

      const card = document.createElement('div');
      card.className = 'eip-card';
      
      let html = `
        <button class="eip-card-close" data-id="${data.id}">✕</button>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
          <span class="eip-tag">&lt;${data.tag}&gt;</span>
          ${data.reactName ? `<span class="eip-badge eip-badge-react">${data.reactName}</span>` : ''}
          ${data.isInteractive ? `<span class="eip-badge eip-badge-interactive">INTERACTIVE</span>` : ''}
          ${data.isShadowHost ? `<span class="eip-badge eip-badge-shadow">SHADOW HOST</span>` : ''}
          ${data.isShadow ? `<span class="eip-badge eip-badge-shadow">SHADOW</span>` : ''}
        </div>
      `;

      if (state.selectorType === 'css' || state.selectorType === 'both') {
        html += `
          <div class="eip-selector-row">
            <span class="eip-selector-label">CSS</span>
            <span class="eip-selector-value">${data.css.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
            <button class="eip-copy-inline" data-copy="${data.css.replace(/"/g, '&quot;')}">Copy</button>
          </div>
        `;
      }

      if (state.selectorType === 'xpath' || state.selectorType === 'both') {
        html += `
          <div class="eip-selector-row">
            <span class="eip-selector-label">XPath</span>
            <span class="eip-selector-value">${data.xpath.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
            <button class="eip-copy-inline" data-copy="${data.xpath.replace(/"/g, '&quot;')}">Copy</button>
          </div>
        `;
      }

      if (data.options && data.options.length > 0) {
        html += `<div style="margin-top:6px;margin-bottom:6px;font-size:10px;color:var(--text-muted);">Available Options: ${data.options.map(o => o.text).join(', ')}</div>`;
      }

      html += `
        <div class="eip-code-label">Generated Code</div>
        <div class="eip-code-block">
          ${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          <button class="eip-copy-btn" data-copy="${code.replace(/"/g, '&quot;')}">Copy</button>
        </div>
      `;

      card.innerHTML = html;
      UI.selectedContainer.appendChild(card);
    });

    // Attach events
    UI.selectedContainer.querySelectorAll('.eip-card-close').forEach(btn => {
      btn.onclick = () => removeSelected(btn.getAttribute('data-id'));
    });

    UI.selectedContainer.querySelectorAll('.eip-copy-btn, .eip-copy-inline').forEach(btn => {
      btn.onclick = () => {
        navigator.clipboard.writeText(btn.getAttribute('data-copy'));
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = originalText, 1500);
      };
    });
  }

  function filterTree(query) {
    const q = query.toLowerCase();
    UI.treeContainer.querySelectorAll('.eip-tree-node').forEach(node => {
      const item = node.querySelector('.eip-tree-item');
      if (!item) return;
      const text = item.innerText.toLowerCase();
      if (text.includes(q)) {
        node.style.display = 'block';
        // show parents
        let parent = node.parentElement;
        while(parent && parent.classList.contains('eip-tree-node')) {
          parent.style.display = 'block';
          parent = parent.parentElement;
        }
      } else {
        node.style.display = 'none';
      }
    });
    if (!q) {
      UI.treeContainer.querySelectorAll('.eip-tree-node').forEach(node => {
        node.style.display = 'block';
      });
    }
  }

  function exportData() {
    if (state.selectedElements.length === 0) {
      alert("No elements selected to export.");
      return;
    }

    const format = state.exportFormat || 'json';

    const dataRows = state.selectedElements.map(s => {
      return {
        tag: s.tag,
        reactComponent: s.reactName || '',
        cssSelector: s.css,
        xpath: s.xpath,
        ariaLabel: s.element.getAttribute('aria-label') || '',
        dataTestId: (getBestDataTestAttribute(s.element) || {}).value || '',
        text: s.element.innerText ? s.element.innerText.substring(0, 50).replace(/\n/g, ' ') : '',
        isInteractive: s.isInteractive,
        isShadowDOM: s.isShadowHost,
        generatedCode: generateCode(s.element, s.css, s.xpath)
      };
    });

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(dataRows, null, 2)], {type: 'application/json'});
      downloadBlob(blob, 'element-inspector-export.json');
    }
    
    if (format === 'csv') {
      const headers = Object.keys(dataRows[0]);
      const csvContent = [
        headers.join(','),
        ...dataRows.map(row => headers.map(header => {
          const val = row[header];
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], {type: 'text/csv'});
      downloadBlob(blob, 'element-inspector-export.csv');
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  initUI();
})();
