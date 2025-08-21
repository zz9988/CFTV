import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  longPressDelay?: number;
  moveThreshold?: number;
}

interface TouchPosition {
  x: number;
  y: number;
}

export const useLongPress = ({
  onLongPress,
  onClick,
  longPressDelay = 500,
  moveThreshold = 10,
}: UseLongPressOptions) => {
  const isLongPress = useRef(false);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const startPosition = useRef<TouchPosition | null>(null);
  const isActive = useRef(false); // 防止重复触发
  const wasButton = useRef(false); // 记录触摸开始时是否是按钮

  const clearTimer = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleStart = useCallback(
    (clientX: number, clientY: number, isButton: boolean = false) => {
      console.log('🟡 handleStart - isButton:', isButton, 'isActive:', isActive.current);

      // 如果已经有活跃的手势，忽略新的开始
      if (isActive.current) {
        console.log('🔴 handleStart - 已有活跃手势，忽略');
        return;
      }

      isActive.current = true;
      isLongPress.current = false;
      startPosition.current = { x: clientX, y: clientY };

      // 记录触摸开始时是否是按钮
      wasButton.current = isButton;
      console.log('🟢 handleStart - 设置状态完成，wasButton:', wasButton.current);

      pressTimer.current = setTimeout(() => {
        // 再次检查是否仍然活跃
        if (!isActive.current) return;

        isLongPress.current = true;
        console.log('🔵 长按触发');

        // 添加触觉反馈（如果支持）
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }

        // 触发长按事件
        onLongPress();
      }, longPressDelay);
    },
    [onLongPress, longPressDelay]
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!startPosition.current || !isActive.current) return;

      const distance = Math.sqrt(
        Math.pow(clientX - startPosition.current.x, 2) +
        Math.pow(clientY - startPosition.current.y, 2)
      );

      // 如果移动距离超过阈值，取消长按
      if (distance > moveThreshold) {
        console.log('🔴 handleMove - 移动距离超过阈值，取消手势, distance:', distance, 'threshold:', moveThreshold);
        clearTimer();
        isActive.current = false;
      }
    },
    [clearTimer, moveThreshold]
  );

  const handleEnd = useCallback(() => {
    console.log('🟡 handleEnd - isLongPress:', isLongPress.current, 'wasButton:', wasButton.current, 'isActive:', isActive.current, 'hasOnClick:', !!onClick);

    clearTimer();

    // 根据情况决定是否触发点击事件：
    // 1. 如果是长按，不触发点击
    // 2. 如果不是长按且触摸开始时是按钮，不触发点击
    // 3. 否则触发点击
    const shouldClick = !isLongPress.current && !wasButton.current && onClick && isActive.current;
    console.log('🟢 handleEnd - shouldClick:', shouldClick);

    if (shouldClick) {
      console.log('🚀 触发点击事件');
      onClick();
    } else {
      console.log('❌ 不触发点击事件 - 原因:', {
        isLongPress: isLongPress.current,
        wasButton: wasButton.current,
        hasOnClick: !!onClick,
        isActive: isActive.current
      });
    }

    // 重置所有状态
    isLongPress.current = false;
    startPosition.current = null;
    isActive.current = false;
    wasButton.current = false;
  }, [clearTimer, onClick]);

  // 触摸事件处理器
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      console.log('📱 onTouchStart - 开始');

      // 检查是否触摸的是按钮或其他交互元素
      const target = e.target as HTMLElement;
      const buttonElement = target.closest('[data-button]');

      // 更精确的按钮检测：只有当触摸目标直接是按钮元素或其直接子元素时才认为是按钮
      const isDirectButton = target.hasAttribute('data-button');
      const isButton = !!buttonElement && isDirectButton;

      console.log('📱 onTouchStart - target:', target.tagName, target.className);
      console.log('📱 onTouchStart - buttonElement:', buttonElement);
      console.log('📱 onTouchStart - isDirectButton:', isDirectButton);
      console.log('📱 onTouchStart - isButton:', isButton);

      // 阻止默认的长按行为，但不阻止触摸开始事件
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY, !!isButton);
    },
    [handleStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      console.log('📱 onTouchMove - 移动');
      handleMove(touch.clientX, touch.clientY);
    },
    [handleMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      console.log('📱 onTouchEnd - 结束');
      // 始终阻止默认行为，避免任何系统长按菜单
      e.preventDefault();
      e.stopPropagation();
      handleEnd();
    },
    [handleEnd]
  );



  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
