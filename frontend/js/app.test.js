const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id = '') {
  const element = {
    id,
    children: [],
    className: '',
    innerHTML: '',
    style: {},
    textContent: '',
    value: '',
    onclick: null,
    listeners: {},
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    addEventListener(event, callback) {
      this.listeners[event] = callback;
    },
    focus() {
      this.focused = true;
    },
    select() {
      this.selected = true;
    },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    },
    querySelector() {
      return createElement();
    },
  };
  return element;
}

function loadApp() {
  const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const elements = new Map();
  const socketListeners = {};
  const socketOnceListeners = {};
  const storage = {};
  const api = {
    createGuestCalls: 0,
    playerId: null,
  };
  const socketCalls = {
    nicknameUpdates: [],
  };

  const context = {
    API: {
      setPlayerId(id) {
        api.playerId = id;
      },
      async createGuest() {
        api.createGuestCalls += 1;
        return {
          success: true,
          data: {
            player: {
              id: 'http-player',
              nickname: 'HttpGuest_1',
              avatar: '#abcdef',
              chips: 1000,
            },
          },
        };
      },
      async getRooms() {
        return { success: true, data: { rooms: [] } };
      },
    },
    console,
    document: {
      body: createElement('body'),
      addEventListener() {},
      createElement,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement(id));
        return elements.get(id);
      },
    },
    localStorage: {
      getItem(key) {
        return storage[key] || null;
      },
      removeItem(key) {
        delete storage[key];
      },
      setItem(key, value) {
        storage[key] = value;
      },
    },
    window: {
      addEventListener() {},
      location: { hash: '#/' },
    },
    LobbyView: {
      hide() {},
      init() {},
      loadRooms() {},
      show() {},
    },
    RoomView: {
      hide() {},
      init() {},
      show() {},
    },
    SocketClient: {
      connect() {},
      isConnected() {
        return false;
      },
      off(event) {
        delete socketListeners[event];
      },
      on(event, callback) {
        socketListeners[event] = callback;
      },
      once(event, callback) {
        socketOnceListeners[event] = callback;
      },
      setCurrentRoom() {},
      updateNickname(nickname) {
        socketCalls.nicknameUpdates.push(nickname);
      },
    },
    TableView: {
      hide() {},
      init() {},
      show() {},
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__App = App;`,
    context,
    { filename: 'app.js' }
  );

  return {
    api,
    App: context.__App,
    elements,
    socketCalls,
    socketListeners,
    socketOnceListeners,
    storage,
  };
}

test('first connection adopts the socket-bound player instead of creating a second guest', async () => {
  const { api, App, socketListeners, socketOnceListeners, storage } = loadApp();

  await App.init();

  if (socketOnceListeners.connect) {
    await socketOnceListeners.connect();
  }
  await socketListeners.connected({
    playerId: 'socket-player',
    player: {
      id: 'socket-player',
      nickname: 'SocketGuest_1',
      avatar: '#123456',
      chips: 1000,
    },
  });

  assert.equal(api.createGuestCalls, 0);
  assert.equal(api.playerId, 'socket-player');
  assert.equal(App.player.id, 'socket-player');
  assert.equal(App.player.nickname, 'SocketGuest_1');
  assert.match(storage.poker_player, /SocketGuest_1/);
});

test('player updated event refreshes local player name and header', async () => {
  const { App, elements, socketListeners, storage } = loadApp();

  await App.init();
  await socketListeners.connected({
    playerId: 'socket-player',
    player: {
      id: 'socket-player',
      nickname: 'OldName',
      avatar: '#123456',
      chips: 1000,
    },
  });

  await socketListeners['player:updated']({
    player: {
      id: 'socket-player',
      nickname: 'NewName',
      avatar: '#123456',
      chips: 1000,
    },
  });

  assert.equal(App.player.nickname, 'NewName');
  assert.equal(elements.get('user-nickname').textContent, 'NewName');
  assert.match(storage.poker_player, /NewName/);
});

test('clicking the header player name opens the profile modal with the current name', async () => {
  const { App, elements, socketCalls, socketListeners } = loadApp();

  await App.init();
  await socketListeners.connected({
    playerId: 'socket-player',
    player: {
      id: 'socket-player',
      nickname: 'OldName',
      avatar: '#123456',
      chips: 1000,
    },
  });

  elements.get('user-info').listeners.click();

  assert.equal(elements.get('modal-profile').style.display, 'flex');
  assert.equal(elements.get('input-profile-nickname').value, 'OldName');
  assert.equal(elements.get('input-profile-nickname').focused, true);
  assert.equal(elements.get('input-profile-nickname').selected, true);
  assert.deepEqual(socketCalls.nicknameUpdates, []);
});

test('profile modal submit sends a nickname update without using browser prompt', async () => {
  const { App, elements, socketCalls, socketListeners } = loadApp();

  await App.init();
  await socketListeners.connected({
    playerId: 'socket-player',
    player: {
      id: 'socket-player',
      nickname: 'OldName',
      avatar: '#123456',
      chips: 1000,
    },
  });

  elements.get('user-info').listeners.click();
  elements.get('input-profile-nickname').value = 'Renamed Player';
  elements.get('btn-submit-profile').listeners.click();

  assert.deepEqual(socketCalls.nicknameUpdates, ['Renamed Player']);
  assert.equal(elements.get('modal-profile').style.display, 'none');
});
