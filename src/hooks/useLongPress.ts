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

  const clearTimer = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleStart = useCallback(
    (clientX: number, clientY: number, target?: EventTarget) => {
      // 如果已经有活跃的手势，忽略新的开始
      if (isActive.current) return;

      // 检查是否点击的是按钮元素
      if (target && target instanceof Element) {
        const isButton = target.closest('button, [role="button"], [data-role="button"], .cursor-pointer, svg, a');
        if (isButton) {
          // 如果点击的是按钮，不启动长按计时器
          return;
        }
      }

      isActive.current = true;
      isLongPress.current = false;
      startPosition.current = { x: clientX, y: clientY };

      pressTimer.current = setTimeout(() => {
        // 再次检查是否仍然活跃
        if (!isActive.current) return;

        isLongPress.current = true;

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
        clearTimer();
        isActive.current = false;
      }
    },
    [clearTimer, moveThreshold]
  );

  const handleEnd = useCallback(() => {
    clearTimer();

    // 如果不是长按且手势仍然活跃，则触发点击事件
    if (!isLongPress.current && onClick && isActive.current) {
      onClick();
    }

    // 重置所有状态
    isLongPress.current = false;
    startPosition.current = null;
    isActive.current = false;
  }, [clearTimer, onClick]);

  // 触摸事件处理器
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // 阻止默认的长按行为，但不阻止触摸开始事件
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY, e.target);
    },
    [handleStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [handleMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // 始终阻止默认行为，避免任何系统长按菜单
      e.preventDefault();
      e.stopPropagation();
      handleEnd();
    },
    [handleEnd]
  );

  // 鼠标事件处理器（用于桌面端测试）
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleStart(e.clientX, e.clientY, e.target);
    },
    [handleStart]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    },
    [handleMove]
  );

  const onMouseUp = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  const onMouseLeave = useCallback(() => {
    clearTimer();
    isActive.current = false;
  }, [clearTimer]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
  };
};
