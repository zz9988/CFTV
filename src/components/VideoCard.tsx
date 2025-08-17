/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps */

import { Heart, Link, PlayCircleIcon, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
};

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(function VideoCard(
  {
    id,
    title = '',
    query = '',
    poster = '',
    episodes,
    source,
    source_name,
    source_names,
    progress = 0,
    year,
    from,
    currentEpisode,
    douban_id,
    onDelete,
    rate,
    type = '',
    isBangumi = false,
    isAggregate = false,
  }: VideoCardProps,
  ref
) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 可外部修改的可控字段
  const [dynamicEpisodes, setDynamicEpisodes] = useState<number | undefined>(
    episodes
  );
  const [dynamicSourceNames, setDynamicSourceNames] = useState<string[] | undefined>(
    source_names
  );

  useEffect(() => {
    setDynamicEpisodes(episodes);
  }, [episodes]);

  useEffect(() => {
    setDynamicSourceNames(source_names);
  }, [source_names]);

  useImperativeHandle(ref, () => ({
    setEpisodes: (eps?: number) => setDynamicEpisodes(eps),
    setSourceNames: (names?: string[]) => setDynamicSourceNames(names),
  }));

  const actualTitle = title;
  const actualPoster = poster;
  const actualSource = source;
  const actualId = id;
  const actualDoubanId = douban_id;
  const actualEpisodes = dynamicEpisodes;
  const actualYear = year;
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? (actualEpisodes && actualEpisodes === 1 ? 'movie' : 'tv')
    : type;

  // 获取收藏状态（搜索结果页面不检查）
  useEffect(() => {
    if (from === 'douban' || from === 'search' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('检查收藏状态失败');
      }
    };

    fetchFavoriteStatus();

    // 监听收藏状态更新事件
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 检查当前项目是否在新的收藏列表中
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || from === 'search' || !actualSource || !actualId) return;
      try {
        if (favorited) {
          // 如果已收藏，删除收藏
          await deleteFavorite(actualSource, actualId);
          setFavorited(false);
        } else {
          // 如果未收藏，添加收藏
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          setFavorited(true);
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('删除播放记录失败');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const handleClick = useCallback(() => {
    if (from === 'douban' || (isAggregate && !actualSource && !actualId)) {
      router.push(
        `/play?title=${encodeURIComponent(actualTitle.trim())}${actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${isAggregate ? '&prefer=true' : ''}${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''}`
      );
    } else if (actualSource && actualId) {
      router.push(
        `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle
        )}${actualYear ? `&year=${actualYear}` : ''}${isAggregate ? '&prefer=true' : ''
        }${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`
      );
    }
  }, [
    from,
    actualSource,
    actualId,
    router,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
        showYear: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
        showYear: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
        showYear: true,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
        showYear: false,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, douban_id, rate]);

  return (
    <div
      className='group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-[500]'
      onClick={handleClick}
    >
      {/* 海报容器 */}
      <div className='relative aspect-[2/3] overflow-hidden rounded-lg'>
        {/* 骨架屏 */}
        {!isLoading && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}
        {/* 图片 */}
        <Image
          src={processImageUrl(actualPoster)}
          alt={actualTitle}
          fill
          className='object-cover'
          referrerPolicy='no-referrer'
          loading='lazy'
          onLoadingComplete={() => setIsLoading(true)}
          onError={(e) => {
            // 图片加载失败时的重试机制
            const img = e.target as HTMLImageElement;
            if (!img.dataset.retried) {
              img.dataset.retried = 'true';
              setTimeout(() => {
                img.src = processImageUrl(actualPoster);
              }, 2000);
            }
          }}
        />

        {/* 悬浮遮罩 */}
        <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100' />

        {/* 播放按钮 */}
        {config.showPlayButton && (
          <div className='absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100 group-hover:scale-100'>
            <PlayCircleIcon
              size={50}
              strokeWidth={0.8}
              className='text-white fill-transparent transition-all duration-300 ease-out hover:fill-green-500 hover:scale-[1.1]'
            />
          </div>
        )}

        {/* 操作按钮 */}
        {(config.showHeart || config.showCheckCircle) && (
          <div className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:opacity-100 group-hover:translate-y-0'>
            {config.showCheckCircle && (
              <Trash2
                onClick={handleDeleteRecord}
                size={20}
                className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
              />
            )}
            {config.showHeart && (
              <Heart
                onClick={handleToggleFavorite}
                size={20}
                className={`transition-all duration-300 ease-out ${favorited
                  ? 'fill-red-600 stroke-red-600'
                  : 'fill-transparent stroke-white hover:stroke-red-400'
                  } hover:scale-[1.1]`}
              />
            )}
          </div>
        )}

        {/* 年份徽章 */}
        {config.showYear && actualYear && actualYear !== 'unknown' && actualYear.trim() !== '' && (
          <div className={`absolute top-2 bg-black/50 text-white text-xs font-medium px-2 py-1 rounded backdrop-blur-sm shadow-sm transition-all duration-300 ease-out group-hover:opacity-90 ${config.showDoubanLink && actualDoubanId && actualDoubanId !== 0
            ? 'left-2 group-hover:left-11'
            : 'left-2'
            }`}>
            {actualYear}
          </div>
        )}

        {/* 徽章 */}
        {config.showRating && rate && (
          <div className='absolute top-2 right-2 bg-pink-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all duration-300 ease-out group-hover:scale-110'>
            {rate}
          </div>
        )}

        {actualEpisodes && actualEpisodes > 1 && (
          <div className='absolute top-2 right-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-md transition-all duration-300 ease-out group-hover:scale-110'>
            {currentEpisode
              ? `${currentEpisode}/${actualEpisodes}`
              : actualEpisodes}
          </div>
        )}

        {/* 豆瓣链接 */}
        {config.showDoubanLink && actualDoubanId && actualDoubanId !== 0 && (
          <a
            href={
              isBangumi
                ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
            }
            target='_blank'
            rel='noopener noreferrer'
            onClick={(e) => e.stopPropagation()}
            className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 group-hover:opacity-100 group-hover:translate-x-0'
          >
            <div className='bg-green-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
              <Link size={16} />
            </div>
          </a>
        )}

        {/* 聚合播放源指示器 */}
        {isAggregate && dynamicSourceNames && dynamicSourceNames.length > 0 && (() => {
          const uniqueSources = Array.from(new Set(dynamicSourceNames));
          const sourceCount = uniqueSources.length;

          return (
            <div className='absolute bottom-2 right-2 opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100'>
              <div className='relative group/sources'>
                <div className='bg-gray-700 text-white text-xs font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-md hover:bg-gray-600 hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer'>
                  {sourceCount}
                </div>

                {/* 播放源详情悬浮框 */}
                {(() => {
                  // 优先显示的播放源（常见的主流平台）
                  const prioritySources = ['爱奇艺', '腾讯视频', '优酷', '芒果TV', '哔哩哔哩', 'Netflix', 'Disney+'];

                  // 按优先级排序播放源
                  const sortedSources = uniqueSources.sort((a, b) => {
                    const aIndex = prioritySources.indexOf(a);
                    const bIndex = prioritySources.indexOf(b);
                    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                    return a.localeCompare(b);
                  });

                  const maxDisplayCount = 6; // 最多显示6个
                  const displaySources = sortedSources.slice(0, maxDisplayCount);
                  const hasMore = sortedSources.length > maxDisplayCount;
                  const remainingCount = sortedSources.length - maxDisplayCount;

                  return (
                    <div className='absolute bottom-full mb-2 opacity-0 invisible group-hover/sources:opacity-100 group-hover/sources:visible transition-all duration-200 ease-out delay-100 pointer-events-none z-50 right-0 sm:right-0 -translate-x-0 sm:translate-x-0'>
                      <div className='bg-gray-800/90 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/10 p-1.5 sm:p-2 min-w-[100px] sm:min-w-[120px] max-w-[140px] sm:max-w-[200px] overflow-hidden'>
                        {/* 单列布局 */}
                        <div className='space-y-0.5 sm:space-y-1'>
                          {displaySources.map((sourceName, index) => (
                            <div key={index} className='flex items-center gap-1 sm:gap-1.5'>
                              <div className='w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0'></div>
                              <span className='truncate text-[10px] sm:text-xs leading-tight' title={sourceName}>
                                {sourceName}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* 显示更多提示 */}
                        {hasMore && (
                          <div className='mt-1 sm:mt-2 pt-1 sm:pt-1.5 border-t border-gray-700/50'>
                            <div className='flex items-center justify-center text-gray-400'>
                              <span className='text-[10px] sm:text-xs font-medium'>+{remainingCount} 播放源</span>
                            </div>
                          </div>
                        )}

                        {/* 小箭头 */}
                        <div className='absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-gray-800/90'></div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}
      </div>

      {/* 进度条 */}
      {config.showProgress && progress !== undefined && (
        <div className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'>
          <div
            className='h-full bg-green-500 transition-all duration-500 ease-out'
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 标题与来源 */}
      <div className='mt-2 text-center'>
        <div className='relative'>
          <span className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:group-hover:text-green-400 peer'>
            {actualTitle}
          </span>
          {/* 自定义 tooltip */}
          <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none'>
            {actualTitle}
            <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
          </div>
        </div>
        {config.showSourceName && source_name && (
          <span className='block text-xs text-gray-500 dark:text-gray-400 mt-1'>
            <span className='inline-block border rounded px-2 py-0.5 border-gray-500/60 dark:border-gray-400/60 transition-all duration-300 ease-in-out group-hover:border-green-500/60 group-hover:text-green-600 dark:group-hover:text-green-400'>
              {source_name}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

);

export default memo(VideoCard);
