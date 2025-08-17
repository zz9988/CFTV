/**
 * 设备检测工具函数
 */

// 检测是否为移动设备
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;

  // 检测触摸屏支持
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // 检测用户代理
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'tablet'];
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));

  // 检测屏幕尺寸（小于768px认为是移动设备）
  const isSmallScreen = window.innerWidth < 768;

  return hasTouchScreen && (isMobileUA || isSmallScreen);
};

// 检测是否为触摸设备
export const isTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

// 获取设备类型
export const getDeviceType = (): 'mobile' | 'tablet' | 'desktop' => {
  if (typeof window === 'undefined') return 'desktop';

  const width = window.innerWidth;
  const userAgent = navigator.userAgent.toLowerCase();

  if (width < 768 || userAgent.includes('mobile') || userAgent.includes('iphone')) {
    return 'mobile';
  } else if (width < 1024 || userAgent.includes('tablet') || userAgent.includes('ipad')) {
    return 'tablet';
  } else {
    return 'desktop';
  }
};
