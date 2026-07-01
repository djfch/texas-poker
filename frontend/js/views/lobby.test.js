const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('lobby view can load before the app entrypoint', () => {
  const source = fs.readFileSync(path.join(__dirname, 'lobby.js'), 'utf8');
  const context = {
    console,
    document: {
      addEventListener() {},
      createElement() {
        return { textContent: '', innerHTML: '' };
      },
      getElementById() {
        return {
          addEventListener() {},
          appendChild() {},
          dataset: {},
          focus() {},
          querySelector() {
            return { addEventListener() {} };
          },
          style: {},
          value: '',
        };
      },
      hidden: false,
      querySelectorAll() {
        return [];
      },
    },
    setTimeout,
  };

  assert.doesNotThrow(() => {
    vm.runInNewContext(
      `${source}\n;globalThis.__LobbyView = LobbyView;`,
      context,
      { filename: 'lobby.js' }
    );
  });
  assert.equal(typeof context.__LobbyView.init, 'function');
});
