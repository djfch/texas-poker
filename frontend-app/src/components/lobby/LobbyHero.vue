<script setup lang="ts">
/**
 * LobbyHero.vue - Hero block of the lobby: serif title, gold ornament,
 * subtitle and the two primary actions (quick start / create room).
 */
defineProps<{
  /** Disables the quick-start button while a quick-start flow runs. */
  quickStarting: boolean
}>()

const emit = defineEmits<{
  'quick-start': []
  create: []
}>()
</script>

<template>
  <section class="hero">
    <h1 class="hero-title">德州扑克</h1>
    <div class="hero-ornament" aria-hidden="true">
      <span class="ornament-line" />
      <span class="ornament-diamond">◆</span>
      <span class="ornament-line" />
    </div>
    <p class="hero-subtitle">在线玩德州扑克，支持好友对战和AI机器人</p>
    <div class="hero-actions">
      <van-button
        type="primary"
        size="large"
        :loading="quickStarting"
        loading-text="正在寻找游戏..."
        data-testid="btn-quick-start"
        @click="emit('quick-start')"
      >
        快速开始
      </van-button>
      <van-button size="large" data-testid="btn-create-room" @click="emit('create')">
        创建房间
      </van-button>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--casino-space-7) var(--casino-space-4) var(--casino-space-5);
  text-align: center;
}

.hero-title {
  margin: 0;
  font-family: var(--casino-font-title);
  font-size: var(--casino-font-size-xl);
  letter-spacing: 6px;
  color: var(--casino-gold);
  text-shadow: var(--casino-shadow-gold);
}

.hero-ornament {
  display: flex;
  align-items: center;
  gap: var(--casino-space-3);
  margin: var(--casino-space-3) 0;
  width: 200px;
}

.ornament-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--casino-gold-deep));
}

.ornament-line:last-child {
  background: linear-gradient(90deg, var(--casino-gold-deep), transparent);
}

.ornament-diamond {
  color: var(--casino-gold);
  font-size: var(--casino-font-size-xs);
}

.hero-subtitle {
  margin: 0 0 var(--casino-space-5);
  color: var(--casino-ivory-dim);
  font-size: var(--casino-font-size-sm);
}

.hero-actions {
  display: flex;
  gap: var(--casino-space-3);
  width: 100%;
  max-width: 320px;
}

.hero-actions .van-button {
  flex: 1;
}
</style>
