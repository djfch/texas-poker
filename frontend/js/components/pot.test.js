const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(tagName = 'div') {
  let html = '';
  const element = {
    tagName,
    children: [],
    className: '',
    dataset: {},
    id: '',
    parentElement: null,
    style: {},
    textContent: '',
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      this.children = [];

      const potValueMatch = value.match(/id="pot-value"[^>]*>([^<]*)</);
      if (potValueMatch) {
        const valueEl = createElement('span');
        valueEl.id = 'pot-value';
        valueEl.textContent = potValueMatch[1];
        this.appendChild(valueEl);
      }

      const sideValueMatch = value.match(/class="pot-side-value"[^>]*>([^<]*)</);
      if (sideValueMatch) {
        const valueEl = createElement('span');
        valueEl.className = 'pot-side-value';
        valueEl.textContent = sideValueMatch[1];
        this.appendChild(valueEl);
      }
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    },
    querySelector(selector) {
      const matches = child => {
        if (selector.startsWith('#')) return child.id === selector.slice(1);
        if (selector.startsWith('.')) {
          return child.className.split(/\s+/).includes(selector.slice(1));
        }
        return false;
      };

      const visit = node => {
        for (const child of node.children) {
          if (matches(child)) return child;
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };

      return visit(this);
    },
  };
  return element;
}

function loadPotComponent() {
  const source = fs.readFileSync(path.join(__dirname, 'pot.js'), 'utf8');
  const elements = new Map();
  const context = {
    document: {
      createElement,
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    performance: {
      now() {
        return 0;
      },
    },
    requestAnimationFrame(callback) {
      callback(1000);
      return 1;
    },
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__PotComponent = PotComponent;`,
    context,
    { filename: 'pot.js' }
  );

  return { PotComponent: context.__PotComponent, elements };
}

test('mount displays total pot as primary amount while keeping side pot detail', () => {
  const { PotComponent } = loadPotComponent();
  const container = createElement('div');

  PotComponent.mount(container, 30, [{ amount: 10 }], 40);

  assert.equal(container.querySelector('#pot-value').textContent, '¥40');
  assert.equal(container.querySelector('.pot-side-value').textContent, '¥10');
});

test('update refreshes total pot and existing side pot amounts', () => {
  const { PotComponent, elements } = loadPotComponent();
  const container = createElement('div');
  PotComponent.mount(container, 30, [{ amount: 10 }], 40);
  const potRoot = container.children[0];
  elements.set('pot-display-root', potRoot);

  PotComponent.update(30, [{ amount: 30 }], 60);

  assert.equal(container.querySelector('#pot-value').textContent, '¥60');
  assert.equal(container.querySelector('.pot-side-value').textContent, '¥30');
});
