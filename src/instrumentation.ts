/* eslint-disable */
/**
 * Next.js Instrumentation Hook
 * 在应用启动时执行关键检查，失败时立即退出
 */

import * as crypto from 'crypto';

// 认证相关接口定义
export interface APIResponse {
  success: boolean;
  message: string;
  data?: any;
  timestamp: number;
  signature: string;
  server_fingerprint: string;
}

export interface ServerInfo {
  encrypted_public_key: string;
  fingerprint: string;
  encryption_method: string;
  note: string;
}

// API密钥 - 用于解密公钥
const API_SECRET = 'moontv-is-the-best';

// 验证服务器地址
const AUTH_SERVER = 'https://moontv-auth.ihtw.moe';

// 全局变量存储公钥和指纹
let serverPublicKey: crypto.KeyObject | null = null;
let expectedFingerprint = '';

// 验证相关的全局变量
let currentMachineCode = '';

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
      throw new Error(`API错误: ${apiResp.message}`);
    }

    const serverInfo = apiResp.data as ServerInfo;
    const encryptedPublicKey = serverInfo.encrypted_public_key;
    const serverFingerprint = serverInfo.fingerprint;
    const decryptedPublicKeyPem = decryptWithAES(encryptedPublicKey, API_SECRET);

    console.log('✅ 公钥解密成功');

    return { publicKey: decryptedPublicKeyPem, fingerprint: serverFingerprint };

  } catch (error) {
    throw new Error(`获取服务器公钥失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 验证API响应的签名
 */
async function verifyResponse(apiResp: APIResponse, requestTimestamp: string): Promise<void> {
  if (!serverPublicKey) {
    throw new Error('未获取服务器公钥');
  }

  // 验证服务器指纹
  if (expectedFingerprint && apiResp.server_fingerprint !== expectedFingerprint) {
    throw new Error('服务器指纹不匹配，可能是伪造的服务器');
  }

  try {
    // 现在服务端只对时间戳字符串进行签名，而不是整个响应对象
    // 使用我们发送请求时的时间戳，而不是响应中的时间戳
    const timestampToVerify = requestTimestamp;
    const verified = await verifyTimestampSignature(timestampToVerify, apiResp.signature);

    if (!verified) {
      throw new Error('时间戳签名验证失败');
    }

  } catch (error) {
    throw new Error(`签名验证失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 验证时间戳的RSA签名（服务端现在只对时间戳字符串进行签名）
 */
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

/**
 * 模拟Go的json.Marshal行为进行JSON序列化
 * Go对map[string]interface{}会按键的字母顺序排序
 */
function serializeAsGoJsonMarshal(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';

  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }

  // 处理BigInt类型
  if (typeof obj === 'bigint') {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    const items = obj.map(item => serializeAsGoJsonMarshal(item));
    return '[' + items.join(',') + ']';
  }

  if (typeof obj === 'object') {
    // 按键的字母顺序排序（Go的map[string]interface{}行为）
    const sortedKeys = Object.keys(obj).sort();
    const pairs: string[] = [];

    for (const key of sortedKeys) {
      if (obj[key] !== undefined) {
        const serializedKey = JSON.stringify(key);
        const serializedValue = serializeAsGoJsonMarshal(obj[key]);
        pairs.push(`${serializedKey}:${serializedValue}`);
      }
    }

    return '{' + pairs.join(',') + '}';
  }

  // 处理其他类型，包括可能的BigInt
  try {
    return JSON.stringify(obj);
  } catch (error) {
    // 如果JSON.stringify失败（比如因为BigInt），尝试转换为字符串
    if (error instanceof TypeError && error.message.includes('BigInt')) {
      return String(obj);
    }
    throw error;
  }
}

/**
 * 注册设备到认证服务器
 */
async function registerDevice(authCode: string, deviceCode: string) {
  try {
    // 生成请求时间戳
    const requestTimestamp = Date.now().toString();

    // 设置10秒超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${AUTH_SERVER}/api/register_device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MoonTV/1.0.0'
      },
      body: JSON.stringify({
        auth_code: authCode,
        device_code: deviceCode,
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
      throw new Error(`设备注册失败: ${apiResp.message}`);
    }

    console.log(`✅ 设备注册成功`);
  } catch (error) {
    throw new Error(`设备注册失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}





/**
 * 环境变量检查
 */
function checkEnvironment(): void {
  // 检查 USERNAME
  const username = process.env.USERNAME;
  if (!username || username.trim() === '') {
    console.error('❌ USERNAME 环境变量不得为空');
    console.error('🚨 环境变量检查失败，服务器即将退出');
    process.exit(1);
  }

  // 检查 PASSWORD
  const password = process.env.PASSWORD;
  if (!password || password.trim() === '') {
    console.error('❌ PASSWORD 环境变量不得为空');
    console.error('🚨 环境变量检查失败，服务器即将退出');
    process.exit(1);
  }

  // 检查弱密码
  const weakPasswords = [
    'admin_password',
    'password',
    '123456',
    'admin',
    'root',
    'password123',
    '12345678',
    'qwerty',
    'abc123',
    'admin123',
    'test123',
    'password1',
    '000000',
    '111111',
    '11111111112233',
    '112233',
    '123123',
    '123321',
    '654321',
    '666666',
    '888888',
    'abcdef',
    'abcabc',
    'a1b2c3',
    'aaa111',
    '123qwe',
    'qweasd'
  ];

  if (weakPasswords.includes(password.toLowerCase())) {
    console.error(`❌ PASSWORD 不能使用常见弱密码: ${password}`);
    console.error('🚨 环境变量检查失败，服务器即将退出');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ PASSWORD 长度不能少于8位');
    console.error('🚨 环境变量检查失败，服务器即将退出');
    process.exit(1);
  }

  // 检查密码不能与用户名相同
  if (password.toLowerCase() === username.toLowerCase()) {
    console.error('❌ PASSWORD 不能与 USERNAME 相同');
    console.error('🚨 环境变量检查失败，服务器即将退出');
    process.exit(1);
  }

  // 检查 AUTH_TOKEN
  const authToken = process.env.AUTH_TOKEN;
  if (!authToken || authToken.trim() === '') {
    console.error('❌ AUTH_TOKEN 不得为空');
    console.error('🚨 环境变量检查失败，服务器即将退出');
    process.exit(1);
  }

  // 检查 AUTH_SERVER（可选，但如果设置了需要验证格式）
  const authServer = process.env.AUTH_SERVER;
  if (authServer && authServer.trim() !== '') {
    if (!authServer.startsWith('https://') && !authServer.startsWith('http://')) {
      console.error('❌ AUTH_SERVER 必须以 http:// 或 https:// 开头');
      console.error('🚨 环境变量检查失败，服务器即将退出');
      process.exit(1);
    }
  }
}

/**
 * 认证检查
 */
async function checkAuthentication(): Promise<void> {
  // 获取环境变量
  const authToken = process.env.AUTH_TOKEN;
  const username = process.env.USERNAME;
  const password = process.env.PASSWORD;

  if (!authToken || !username || !password) {
    console.error('❌ 认证检查失败：缺少必需的环境变量');
    console.error('🚨 认证检查失败，服务器即将退出');
    process.exit(1);
  }

  try {
    // 第一步：生成机器码
    const combinedString = authToken + username + password;
    const encoder = new TextEncoder();
    const data = encoder.encode(combinedString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const machineCode = hashHex.substring(0, 16);
    currentMachineCode = machineCode; // 保存到全局变量

    // 第二步：从验证服务器获取公钥
    const { publicKey, fingerprint } = await fetchServerPublicKey();

    // 设置全局变量供签名验证使用
    // 将PEM格式的公钥字符串转换为KeyObject
    try {
      serverPublicKey = crypto.createPublicKey({
        key: publicKey,
        format: 'pem',
        type: 'spki'
      });
    } catch (keyError) {
      console.error('❌ 公钥KeyObject创建失败:', keyError);
      throw new Error(`公钥格式错误: ${keyError instanceof Error ? keyError.message : '未知错误'}`);
    }
    expectedFingerprint = fingerprint;

    console.log('🔑 公钥获取成功，准备进行设备注册');

    // 第三步：注册设备
    // 使用机器码作为认证码和设备码
    const deviceCode = machineCode;
    await registerDevice(authToken, deviceCode);

    console.log('🎉 设备认证流程完成');
  } catch (error) {
    console.error('❌ 认证流程失败:', error instanceof Error ? error.message : '未知错误');
    console.error('🚨 认证检查失败，服务器即将退出');
    process.exit(1);
  }
}

/**
 * 数据库配置检查
 */
function checkDatabaseConfig(): void {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 检查存储类型配置
  const allowedStorageTypes = ['localstorage', 'kvrocks', 'upstash', 'redis'];
  if (!allowedStorageTypes.includes(storageType)) {
    console.error(`❌ NEXT_PUBLIC_STORAGE_TYPE 必须是 ${allowedStorageTypes.join(', ')} 之一，当前值: ${storageType}`);
    console.error('🚨 数据库配置检查失败，服务器即将退出');
    process.exit(1);
  }

  // 根据存储类型检查相应的环境变量
  switch (storageType) {
    case 'kvrocks':
      const kvrocksUrl = process.env.KVROCKS_URL;
      if (!kvrocksUrl || kvrocksUrl.trim() === '') {
        console.error('❌ KVROCKS_URL 环境变量不得为空');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }
      if (!kvrocksUrl.startsWith('redis://')) {
        console.error('❌ KVROCKS_URL 必须以 redis:// 开头');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }
      break;

    case 'upstash':
      const upstashUrl = process.env.UPSTASH_URL;
      const upstashToken = process.env.UPSTASH_TOKEN;

      if (!upstashUrl || upstashUrl.trim() === '') {
        console.error('❌ UPSTASH_URL 环境变量不得为空');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }
      if (!upstashUrl.startsWith('https://')) {
        console.error('❌ UPSTASH_URL 必须以 https:// 开头');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }

      if (!upstashToken || upstashToken.trim() === '') {
        console.error('❌ UPSTASH_TOKEN 环境变量不得为空');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }
      break;

    case 'redis':
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl || redisUrl.trim() === '') {
        console.error('❌ REDIS_URL 环境变量不得为空');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }
      if (!redisUrl.startsWith('redis://')) {
        console.error('❌ REDIS_URL 必须以 redis:// 开头');
        console.error('🚨 数据库配置检查失败，服务器即将退出');
        process.exit(1);
      }
      break;
  }
}

/**
 * 执行启动检查并在失败时退出
 */
async function runCriticalStartupChecks(): Promise<void> {
  console.log('🔧 执行关键启动检查...');

  // 1. 环境变量检查
  console.log('📝 检查环境变量...');
  checkEnvironment();
  console.log('✅ 环境变量检查通过');

  // 2. 认证检查
  console.log('🔐 检查认证信息...');
  await checkAuthentication();
  console.log('✅ 认证检查通过');

  // 3. 数据库配置检查
  console.log('🗄️ 检查数据库配置...');
  checkDatabaseConfig();
  console.log('✅ 数据库配置检查通过');

  console.log('🎉 所有关键检查通过，服务器正常启动');
}

/**
 * Next.js Instrumentation Hook
 * 这个函数会在应用启动时自动被 Next.js 调用
 */
export async function register() {
  // 只在服务器端运行
  if (typeof window === 'undefined') {
    console.log('🚀 MoonTV 启动检查开始...');

    // 注册进程退出事件处理
    process.on('SIGINT', () => {
      console.log('\n🛑 收到 SIGINT 信号，正在优雅关闭...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 收到 SIGTERM 信号，正在优雅关闭...');
      process.exit(0);
    });

    try {
      await runCriticalStartupChecks();
    } catch (error) {
      console.error('💥 启动检查过程中发生未预期错误:', error);
      console.error('🚨 服务器即将退出');
      process.exit(1);
    }
  }
}

// 导出检查函数供其他模块使用（如果需要）
export {
  checkAuthentication,
  checkDatabaseConfig,
  checkEnvironment,
  decryptWithAES,
  fetchServerPublicKey,
  verifyResponse,
  verifyTimestampSignature,
  serializeAsGoJsonMarshal
};