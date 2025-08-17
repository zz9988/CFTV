import { SearchResult } from '@/lib/types';

// 缓存状态类型
export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

// 缓存条目接口
export interface CachedPageEntry {
  expiresAt: number;
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number; // 仅第一页可选存储
}

// 缓存配置
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分钟清理一次
const MAX_CACHE_SIZE = 1000; // 最大缓存条目数量
const SEARCH_CACHE: Map<string, CachedPageEntry> = new Map();

// 自动清理定时器
let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

/**
 * 生成搜索缓存键：source + query + page
 */
function makeSearchCacheKey(sourceKey: string, query: string, page: number): string {
  return `${sourceKey}::${query.trim()}::${page}`;
}

/**
 * 获取缓存的搜索页面数据
 */
export function getCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number
): CachedPageEntry | null {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;

  // 检查是否过期
  if (entry.expiresAt <= Date.now()) {
    SEARCH_CACHE.delete(key);
    return null;
  }

  return entry;
}

/**
 * 设置缓存的搜索页面数据
 */
export function setCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number
): void {
  // 惰性启动自动清理
  ensureAutoCleanupStarted();

  // 惰性清理：每次写入时检查是否需要清理
  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    const stats = performCacheCleanup();
    if (stats.expired > 0 || stats.sizeLimited > 0) {
      console.log(`🧹 惰性缓存清理: 删除过期${stats.expired}项，删除超限${stats.sizeLimited}项，剩余${stats.total}项`);
    }
  }

  const key = makeSearchCacheKey(sourceKey, query, page);
  SEARCH_CACHE.set(key, {
    expiresAt: now + SEARCH_CACHE_TTL_MS,
    status,
    data,
    pageCount,
  });
}

/**
 * 确保自动清理已启动（惰性初始化）
 */
function ensureAutoCleanupStarted(): void {
  if (!cleanupTimer) {
    startAutoCleanup();
    console.log(`🚀 启动自动缓存清理，间隔${CACHE_CLEANUP_INTERVAL_MS / 1000}秒，最大缓存${MAX_CACHE_SIZE}项`);
  }
}

/**
 * 智能清理过期的缓存条目
 */
function performCacheCleanup(): { expired: number; total: number; sizeLimited: number } {
  const now = Date.now();
  const keysToDelete: string[] = [];
  let sizeLimitedDeleted = 0;

  // 1. 清理过期条目
  SEARCH_CACHE.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      keysToDelete.push(key);
    }
  });

  const expiredCount = keysToDelete.length;
  keysToDelete.forEach(key => SEARCH_CACHE.delete(key));

  // 2. 如果缓存大小超限，清理最老的条目（LRU策略）
  if (SEARCH_CACHE.size > MAX_CACHE_SIZE) {
    const entries = Array.from(SEARCH_CACHE.entries());
    // 按照过期时间排序，最早过期的在前面
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);

    const toRemove = SEARCH_CACHE.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      SEARCH_CACHE.delete(entries[i][0]);
      sizeLimitedDeleted++;
    }
  }

  lastCleanupTime = now;

  return {
    expired: expiredCount,
    total: SEARCH_CACHE.size,
    sizeLimited: sizeLimitedDeleted
  };
}

/**
 * 启动自动清理定时器
 */
function startAutoCleanup(): void {
  if (cleanupTimer) return; // 避免重复启动

  cleanupTimer = setInterval(() => {
    const stats = performCacheCleanup();
    if (stats.expired > 0 || stats.sizeLimited > 0) {
      console.log(`🧹 自动缓存清理: 删除过期${stats.expired}项，删除超限${stats.sizeLimited}项，剩余${stats.total}项`);
    }
  }, CACHE_CLEANUP_INTERVAL_MS);

  // 在 Node.js 环境中避免阻止程序退出
  if (typeof process !== 'undefined' && cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}
