const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(tagName = 'div') {
  const element = {
    tagName,
    children: [],
    className: '',
    dataset: {},
    innerHTML: '',
    style: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    classList: {
      add(...names) {
        element.className = [element.className, ...names].filter(Boolean).join(' ');
      },
    },
  };
  return element;
}

function loadCardComponent() {
  const source = fs.readFileSync(path.join(__dirname, 'card.js'), 'utf8');
  const context = {
    document: {
      body: createElement('body'),
      createElement,
      querySelector() {
        return null;
      },
    },
    setTimeout,
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__CardComponent = CardComponent;`,
    context,
    { filename: 'card.js' }
  );

  return context.__CardComponent;
}

test('renders compact string cards with rank and suit data', () => {
  const CardComponent = loadCardComponent();

  const card = CardComponent.render('A\u2660');

  assert.equal(card.dataset.rank, 'A');
  assert.equal(card.dataset.suit, 'spades');
  assert.match(card.className, /card-black/);
  assert.match(card.innerHTML, /A/);
});
