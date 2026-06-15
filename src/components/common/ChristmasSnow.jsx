import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { keyframes } from '@emotion/react';

// 圣诞配色方案
export const CHRISTMAS_COLORS = {
    // 主色调
    primary: '#c41e3a',      // 深红色 (Cranberry Red)
    secondary: '#165B33',    // 深绿色 (Hunter Green)
    // 辅助色
    gold: '#FFD700',         // 金色
    ivory: '#FFFFF0',        // 象牙白
    holly: '#00563F',        // 冬青绿
    burgundy: '#800020',     // 酒红色
    snow: '#FFFAFA',         // 雪白
    pine: '#01796F',         // 松绿色
    // 渐变
    gradient: 'linear-gradient(135deg, #c41e3a 0%, #165B33 100%)',
    softGradient: 'linear-gradient(135deg, rgba(196, 30, 58, 0.1) 0%, rgba(22, 91, 51, 0.1) 100%)'
};

// 雪花飘落动画
const snowfall = keyframes`
  0% {
    transform: translateY(-10px) translateX(0) rotate(0deg);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  90% {
    opacity: 0.8;
  }
  100% {
    transform: translateY(100vh) translateX(30px) rotate(360deg);
    opacity: 0;
  }
`;

const ChristmasDecorations = () => {
    // 生成雪花数据 - 使用 useMemo 避免重渲染时重新生成
    const snowflakes = useMemo(() => {
        return Array.from({ length: 60 }).map((_, i) => ({
            id: i,
            left: Math.random() * 100,
            size: Math.random() * 4 + 2, // 2-6px 小微粒
            duration: Math.random() * 8 + 6, // 6-14秒
            delay: Math.random() * 10, // 0-10秒延迟
            opacity: Math.random() * 0.5 + 0.3, // 0.3-0.8透明度
        }));
    }, []);

    const borderWidth = '4px';
    const borderRadius = '8px';

    return (
        <>
            {/* 
        四周渐变边框 - 使用 mask 技术实现镂空 
        background 填充整个区域，然后 mask 将中间部分(content-box)与整体(border-box)进行 xor 运算，只保留边框
      */}
            <Box
                sx={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 9998,
                    pointerEvents: 'none',
                    padding: borderWidth,
                    borderRadius: borderRadius,
                    background: `linear-gradient(135deg, #c41e3a 0%, #165B33 25%, #c41e3a 50%, #165B33 75%, #c41e3a 100%)`,
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                }}
            />

            {/* 雪花飘落效果 */}
            <Box
                sx={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 9997,
                    overflow: 'hidden',
                }}
            >
                {snowflakes.map((flake) => (
                    <Box
                        key={flake.id}
                        sx={{
                            position: 'absolute',
                            left: `${flake.left}%`,
                            top: -10,
                            width: `${flake.size}px`,
                            height: `${flake.size}px`,
                            borderRadius: '50%',
                            backgroundColor: '#a5d8ff', // 淡蓝色
                            boxShadow: '0 0 4px #74c0fc', // 增强发光效果
                            opacity: flake.opacity,
                            animation: `${snowfall} ${flake.duration}s linear infinite`,
                            animationDelay: `${flake.delay}s`,
                        }}
                    />
                ))}
            </Box>
        </>
    );
};

export default ChristmasDecorations;
