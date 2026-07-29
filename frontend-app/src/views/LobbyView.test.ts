/**
 * LobbyView.test.ts - Lobby view behavior: renders the public room list and
 * clicking join drives the lobby store flow (REST join + socket join +
 * navigation). api/socket services and vue-router are mocked; Pinia stores
 * and Vant run for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Vant, { Dialog as VanDialog, Field as VanField } from 'vant'
import type { RoomState } from '@/types'
import LobbyView from '@/views/LobbyView.vue'
import PasswordDialog from '@/components/lobby/PasswordDialog.vue'
import NicknameDialog from '@/components/lobby/NicknameDialog.vue'
import { useLobbyStore } from '@/stores/lobby'
import { usePlayerStore } from '@/stores/player'
import * as api from '@/services/api'
import {
  connect as socketConnect,
  joinRoom as socketJoinRoom,
  updateNickname as socketUpdateNickname,
} from '@/services/socket'

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ params: {} }),
}))

vi.mock('@/services/api', () => ({
  setPlayerId: vi.fn(),
  createGuest: vi.fn(),
  getRooms: vi.fn(),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
}))

vi.mock('@/services/socket', () => ({
  connect: vi.fn(),
  joinRoom: vi.fn(() => true),
  updateNickname: vi.fn(() => true),
}))

function makeRoom(id: string, overrides: Partial<RoomState> = {}): RoomState {
  return {
    id,
    name: `房间${id}`,
    hostId: 'p1',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    playerCount: 1,
    seatedCount: 1,
    createdAt: 1,
    dealerPosition: 0,
    awaitingNextHandReady: false,
    seats: [],
    players: [],
    ...overrides,
  }
}

function mountLobby() {
  return mount(LobbyView, { global: { plugins: [Vant] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

describe('LobbyView', () => {
  it('connects the socket and loads rooms on mount', async () => {
    vi.mocked(api.getRooms).mockResolvedValue({ success: true, data: { success: true, rooms: [] } })
    mountLobby()
    await flushPromises()

    expect(socketConnect).toHaveBeenCalled()
    expect(api.getRooms).toHaveBeenCalled()
  })

  it('renders the public room list', async () => {
    vi.mocked(api.getRooms).mockResolvedValue({
      success: true,
      data: { success: true, rooms: [makeRoom('ABC123'), makeRoom('DEF456')] },
    })
    const wrapper = mountLobby()
    await flushPromises()

    expect(wrapper.find('[data-testid="room-card-ABC123"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="room-card-DEF456"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('房间ABC123')
    expect(wrapper.text()).toContain('盲注 10/20')
  })

  it('shows the empty state when there are no rooms', async () => {
    vi.mocked(api.getRooms).mockResolvedValue({ success: true, data: { success: true, rooms: [] } })
    const wrapper = mountLobby()
    await flushPromises()

    expect(wrapper.find('[data-testid="room-list-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无公开房间')
  })

  it('clicking join on a room triggers the join flow and navigates', async () => {
    const room = makeRoom('ABC123')
    vi.mocked(api.getRooms).mockResolvedValue({
      success: true,
      data: { success: true, rooms: [room] },
    })
    vi.mocked(api.joinRoom).mockResolvedValue({ success: true, data: { success: true, room } })

    const wrapper = mountLobby()
    await flushPromises()

    await wrapper.find('[data-testid="btn-join-ABC123"]').trigger('click')
    await flushPromises()

    // Store flow: REST join, then WS room:join, then navigate to the room.
    expect(api.joinRoom).toHaveBeenCalledWith('ABC123', undefined)
    expect(socketJoinRoom).toHaveBeenCalledWith('ABC123', undefined)
    expect(pushMock).toHaveBeenCalledWith({ name: 'room', params: { id: 'ABC123' } })
  })

  it('opens the password dialog instead of joining a private room directly', async () => {
    vi.mocked(api.getRooms).mockResolvedValue({
      success: true,
      data: { success: true, rooms: [makeRoom('PRV111', { isPrivate: true })] },
    })
    const wrapper = mountLobby()
    await flushPromises()

    await wrapper.find('[data-testid="btn-join-PRV111"]').trigger('click')
    await flushPromises()

    expect(api.joinRoom).not.toHaveBeenCalled()
    expect(wrapper.findComponent(PasswordDialog).props('show')).toBe(true)
  })

  it('quick start joins an existing waiting room when one fits', async () => {
    const room = makeRoom('QS1234')
    vi.mocked(api.getRooms).mockResolvedValue({
      success: true,
      data: { success: true, rooms: [room] },
    })
    vi.mocked(api.joinRoom).mockResolvedValue({ success: true, data: { success: true, room } })

    const wrapper = mountLobby()
    await flushPromises()
    await wrapper.find('[data-testid="btn-quick-start"]').trigger('click')
    await flushPromises()

    expect(api.createRoom).not.toHaveBeenCalled()
    expect(api.joinRoom).toHaveBeenCalledWith('QS1234', undefined)
    expect(pushMock).toHaveBeenCalledWith({ name: 'room', params: { id: 'QS1234' } })
  })

  it('quick start creates a quick room when nothing fits', async () => {
    const created = makeRoom('NEW999')
    vi.mocked(api.getRooms).mockResolvedValue({ success: true, data: { success: true, rooms: [] } })
    vi.mocked(api.createRoom).mockResolvedValue({ success: true, data: { success: true, room: created } })

    const wrapper = mountLobby()
    await flushPromises()
    await wrapper.find('[data-testid="btn-quick-start"]').trigger('click')
    await flushPromises()

    expect(api.createRoom).toHaveBeenCalledWith({
      name: '快速游戏',
      maxPlayers: 6,
      smallBlind: 10,
      bigBlind: 20,
      initialChips: 1000,
      allowAI: true,
    })
    expect(socketJoinRoom).toHaveBeenCalledWith('NEW999')
    expect(pushMock).toHaveBeenCalledWith({ name: 'room', params: { id: 'NEW999' } })
  })

  it('exposes the lobby store error state through the list when loading fails', async () => {
    vi.mocked(api.getRooms).mockResolvedValue({ success: false, error: 'boom' })
    const wrapper = mountLobby()
    await flushPromises()

    expect(useLobbyStore().error).toBe('boom')
    expect(wrapper.find('[data-testid="room-list-error"]').exists()).toBe(true)
  })
})

describe('rename entry', () => {
  async function mountAndOpenDialog() {
    vi.mocked(api.getRooms).mockResolvedValue({ success: true, data: { success: true, rooms: [] } })
    const wrapper = mountLobby()
    await flushPromises()

    await wrapper.find('[data-testid="user-nickname"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('clicking the nickname opens the rename dialog and submits the trimmed name', async () => {
    const wrapper = await mountAndOpenDialog()

    const dialog = wrapper.findComponent(NicknameDialog)
    expect(dialog.props('show')).toBe(true)
    // The field is prefilled with the current nickname.
    expect(dialog.findComponent(VanField).props('modelValue')).toBe('Me')

    dialog.findComponent(VanField).vm.$emit('update:modelValue', '  新昵称  ')
    await flushPromises()
    dialog.findComponent(VanDialog).vm.$emit('confirm')
    await flushPromises()

    expect(socketUpdateNickname).toHaveBeenCalledWith('新昵称')
  })

  it('rejects a blank nickname without calling updateNickname', async () => {
    const wrapper = await mountAndOpenDialog()

    const dialog = wrapper.findComponent(NicknameDialog)
    dialog.findComponent(VanField).vm.$emit('update:modelValue', '   ')
    await flushPromises()
    dialog.findComponent(VanDialog).vm.$emit('confirm')
    await flushPromises()

    expect(socketUpdateNickname).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('昵称不能为空')
  })

  it('shows a failure toast when the rename emit fails', async () => {
    vi.mocked(socketUpdateNickname).mockReturnValueOnce(false)
    const wrapper = await mountAndOpenDialog()

    const dialog = wrapper.findComponent(NicknameDialog)
    dialog.findComponent(VanField).vm.$emit('update:modelValue', '新昵称')
    await flushPromises()
    dialog.findComponent(VanDialog).vm.$emit('confirm')
    await flushPromises()

    expect(socketUpdateNickname).toHaveBeenCalledWith('新昵称')
    expect(document.body.textContent).toContain('修改失败')
  })
})
