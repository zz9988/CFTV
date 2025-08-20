/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';

import { getConfig, refineConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';

// 认证相关接口定义
export interface APIResponse {
  success: boolean;
  message: string;
  data?: any;
  timestamp: number;
  signature: string;
  server_fingerprint: string;
}

const API_SECRET = 'moontv-is-the-best';
// 验证服务器地址
const AUTH_SERVER = 'https://moontv-auth.ihtw.moe';

// 全局变量存储公钥和指纹
let serverPublicKey: crypto.KeyObject | null = null;
let expectedFingerprint = '';

// 验证相关的全局变量
let networkFailureCount = 0;
const MAX_NETWORK_FAILURES = 3;
let currentMachineCode = '';

// 设备认证初始化状态
let isDeviceAuthInitialized = false;

/**
 * 验证响应签名
 */
async function verifyResponse(apiResp: APIResponse, requestTimestamp: string): Promise<void> {
  if (!serverPublicKey) {
    throw new Error('服务器公钥未初始化');
  }

  // 验证服务器指纹
  if (apiResp.server_fingerprint !== expectedFingerprint) {
    throw new Error('服务器指纹验证失败');
  }

  try {
    const timestampToVerify = requestTimestamp;
    const verified = await verifyTimestampSignature(timestampToVerify, apiResp.signature);

    if (!verified) {
      throw new Error('时间戳签名验证失败');
    }

  } catch (error) {
    throw new Error(`签名验证失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

async function verifyTimestampSignature(timestamp: string, signature: string): Promise<boolean> {
  try {
    if (!serverPublicKey) {
      console.error('❌ 服务器公钥未初始化');
      return false;
    }

    // 将时间戳转换为字符串（与Go服务端保持一致）
    const timestampString = String(timestamp);

    // 将十六进制签名转换为Buffer
    const signatureBuffer = Buffer.from(signature, 'hex');

    // 使用正确的方法：验证原始时间戳字符串
    // Go服务端实际上是对原始时间戳字符串进行签名的
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(timestampString, 'utf8');

    const result = verifier.verify(serverPublicKey, signatureBuffer);

    return result;
  } catch (error) {
    console.error('❌ 时间戳签名验证出错:', error);
    return false;
  }
}

export interface ServerInfo {
  encrypted_public_key: string;
  fingerprint: string;
  encryption_method: string;
  note: string;
}

/**
 * 从验证服务器获取公钥
 */
async function fetchServerPublicKey(): Promise<{ publicKey: string, fingerprint: string }> {
  try {
    // 设置10秒超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${AUTH_SERVER}/api/public_key`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MoonTV/1.0.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const apiResp: APIResponse = await response.json();

    if (!apiResp.success) {
      throw new Error(`获取公钥失败: ${apiResp.message}`);
    }

    const serverInfo = apiResp.data as ServerInfo;
    const encryptedPublicKey = serverInfo.encrypted_public_key;
    const serverFingerprint = serverInfo.fingerprint;
    const decryptedPublicKeyPem = decryptWithAES(encryptedPublicKey, API_SECRET);

    return {
      publicKey: decryptedPublicKeyPem,
      fingerprint: serverFingerprint
    };
  } catch (error) {
    throw new Error(`获取公钥失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 使用AES-GCM解密数据
 */
function decryptWithAES(encryptedData: string, key: string): string {
  try {
    // 将密钥转换为32字节（SHA256哈希）
    const keyHash = crypto.createHash('sha256').update(key).digest();

    // Base64解码密文
    const encryptedBytes = Buffer.from(encryptedData, 'base64');

    // 提取nonce（前12字节）和密文
    const nonceSize = 12;
    const nonce = encryptedBytes.slice(0, nonceSize);
    const ciphertext = encryptedBytes.slice(nonceSize, -16); // 除去最后16字节的认证标签
    const tag = encryptedBytes.slice(-16); // 最后16字节是认证标签

    // 创建AES-GCM解密器
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyHash, nonce);
    decipher.setAuthTag(tag);

    const decrypted = decipher.update(ciphertext);
    const final = decipher.final();

    // 合并 Buffer 并转换为字符串
    const result = Buffer.concat([decrypted, final]);
    return result.toString('utf8');
  } catch (error) {
    throw new Error(`AES解密失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 验证设备状态
 */
async function verifyDevice(): Promise<void> {
  try {
    console.log('🔄 开始设备验证...');

    const config = await getConfig();

    // 用户数量设置为0
    const userCount = config.UserConfig?.Users?.length || 0;

    // 生成请求时间戳
    const requestTimestamp = Date.now().toString();

    // 设置10秒超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${AUTH_SERVER}/api/verify_device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MoonTV/1.0.0'
      },
      body: JSON.stringify({
        device_code: currentMachineCode,
        auth_code: process.env.AUTH_TOKEN || '',
        user_count: userCount,
        timestamp: requestTimestamp
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseBody = await response.text();
    const apiResp: APIResponse = JSON.parse(responseBody);

    // 验证响应签名（使用我们发送的时间戳）
    await verifyResponse(apiResp, requestTimestamp);

    if (!apiResp.success) {
      console.error('❌ 设备验证失败');
      console.error(`验证失败原因: ${apiResp.message}`);
      process.exit(1);
    }

    // 重置网络失败计数
    networkFailureCount = 0;
    console.log(`✅ 设备验证通过，用户数量: ${userCount}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';

    // 判断是否为网络问题
    const isNetworkError = errorMessage.includes('fetch') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('aborted');

    if (isNetworkError) {
      networkFailureCount++;
      console.warn(`⚠️ 网络验证失败 (${networkFailureCount}/${MAX_NETWORK_FAILURES}): ${errorMessage}`);

      if (networkFailureCount >= MAX_NETWORK_FAILURES) {
        console.error('❌ 网络验证失败次数超过限制，重置认证信息');
        process.exit(1);
      }
    } else {
      // 非网络错误，直接退出
      console.error('❌ 设备验证失败');
      console.error(`验证失败原因: ${errorMessage}`);
      process.exit(1);
    }
  }
}

/**
 * 初始化设备认证信息
 */
async function initializeDeviceAuth(): Promise<void> {
  // 如果已经初始化过，直接返回
  if (isDeviceAuthInitialized) {
    console.log('🔑 设备认证信息已初始化，跳过重复初始化');
    return;
  }

  try {
    // 获取环境变量
    const authToken = process.env.AUTH_TOKEN;
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;

    if (!authToken || !username || !password) {
      console.log('⚠️ 缺少认证环境变量，跳过设备验证');
      return;
    }

    // 生成机器码
    const combinedString = authToken + username + password;
    const encoder = new TextEncoder();
    const data = encoder.encode(combinedString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const machineCode = hashHex.substring(0, 16);
    currentMachineCode = machineCode;

    // 从验证服务器获取公钥
    const { publicKey, fingerprint } = await fetchServerPublicKey();

    // 设置全局变量供签名验证使用
    try {
      serverPublicKey = crypto.createPublicKey({
        key: publicKey,
        format: 'pem',
        type: 'spki'
      });
    } catch (keyError) {
      console.error('❌ 公钥KeyObject创建失败:', keyError);
      process.exit(1);
    }
    expectedFingerprint = fingerprint;

    // 标记为已初始化
    isDeviceAuthInitialized = true;
    console.log('🔑 设备认证信息初始化成功');
  } catch (error) {
    console.error('❌ 设备认证信息初始化失败:', error);
    process.exit(1);
  }
}

export async function GET(request: NextRequest) {
  console.log(request.url);
  try {
    console.log('Cron job triggered:', new Date().toISOString());

    cronJob();

    return NextResponse.json({
      success: true,
      message: 'Cron job executed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function cronJob() {
  // 初始化设备认证信息
  await initializeDeviceAuth();

  // 执行设备验证
  await verifyDevice();

  // 执行其他定时任务
  await refreshConfig();
  await refreshRecordAndFavorites();
}

async function refreshConfig() {
  let config = await getConfig();
  if (config && config.ConfigSubscribtion && config.ConfigSubscribtion.URL && config.ConfigSubscribtion.AutoUpdate) {
    try {
      const response = await fetch(config.ConfigSubscribtion.URL);

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const configContent = await response.text();

      // 对 configContent 进行 base58 解码
      let decodedContent;
      try {
        const bs58 = (await import('bs58')).default;
        const decodedBytes = bs58.decode(configContent);
        decodedContent = new TextDecoder().decode(decodedBytes);
      } catch (decodeError) {
        console.warn('Base58 解码失败:', decodeError);
        throw decodeError;
      }

      try {
        JSON.parse(decodedContent);
      } catch (e) {
        throw new Error('配置文件格式错误，请检查 JSON 语法');
      }
      config.ConfigFile = decodedContent;
      config.ConfigSubscribtion.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await db.saveAdminConfig(config);
    } catch (e) {
      console.error('刷新配置失败:', e);
    }
  } else {
    console.log('跳过刷新：未配置订阅地址或自动更新');
  }
}

async function refreshRecordAndFavorites() {
  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    // 函数级缓存：key 为 `${source}+${id}`，值为 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    // 获取详情 Promise（带缓存和错误处理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            // 成功时才缓存结果
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            console.error(`获取视频详情失败 (${source}+${id}):`, err);
            return null;
          });
      }
      return promise;
    };

    for (const user of users) {
      console.log(`开始处理用户: ${user}`);

      // 播放记录
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const totalRecords = Object.keys(playRecords).length;
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳过无效的播放记录键: ${key}`);
              continue;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              console.warn(`跳过无法获取详情的播放记录: ${key}`);
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
              });
              console.log(
                `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`处理播放记录失败 (${key}):`, err);
            // 继续处理下一个记录
          }
        }

        console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`获取用户播放记录失败 (${user}):`, err);
      }

      // 收藏
      try {
        const favorites = await db.getAllFavorites(user);
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳过无效的收藏键: ${key}`);
              continue;
            }

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              console.warn(`跳过无法获取详情的收藏: ${key}`);
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.log(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );
            }

            processedFavorites++;
          } catch (err) {
            console.error(`处理收藏失败 (${key}):`, err);
            // 继续处理下一个收藏
          }
        }

        console.log(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`获取用户收藏失败 (${user}):`, err);
      }
    }

    console.log('刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}
