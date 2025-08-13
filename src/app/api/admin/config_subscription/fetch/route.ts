import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: '缺少URL参数' }, { status: 400 });
    }

    // 直接 fetch URL 获取配置内容
    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: `请求失败: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const configContent = await response.text();

    return NextResponse.json({
      success: true,
      configContent,
      message: '配置拉取成功'
    });

  } catch (error) {
    console.error('拉取配置失败:', error);
    return NextResponse.json(
      { error: '拉取配置失败' },
      { status: 500 }
    );
  }
}
