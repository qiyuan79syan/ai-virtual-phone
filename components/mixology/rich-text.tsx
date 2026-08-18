"use client";

// 独家特调 · 富文本渲染：作者的话 / 开场白——写了 HTML 标签就进沙盒 iframe
//（透明底，浮在封面蒙版上，版面完全交给作者），纯文本按原样展示。
// 高度自适应桥与小票画布同款；allow-scripts 无 same-origin，碰不到宿主页面与数据。

import { useEffect, useMemo, useRef, useState } from "react";
import { createMixFrameHeightTracker, nextMixFrameHeight } from "@/lib/mixology/frame-height";

/** 是否含 HTML 标签：含则按作者排版渲染，纯文本走默认样式 */
export function mixTextHasHtml(text: string): boolean {
    return /<\/?[a-z][^>]*>/i.test(text);
}

const FRAME_MIN_HEIGHT = 24;
/**
 * 高度上限。iframe 是 scrolling="no"，高度必须等于内容高度，超出的部分会被直接切掉，
 * 所以这个数就是「开场画布最多能有多高」。原来给 2400（约两屏半），复杂的画布——
 * 多章节、满幅大图、人物关系列表——很容易超过，底下那截在 App 里根本看不到。
 * 放宽到 12000（约十三屏）。仍然留一个上限：万一画布报了个荒谬的数（脚本写错、
 * 死循环撑高），别让宿主去布局一个几十万像素高的元素。
 */
const FRAME_MAX_HEIGHT = 12000;

function RichFrame({ html, inert, onHeight }: { html: string; inert?: boolean; onHeight?: (height: number) => void }) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [frameId] = useState(() => `mrf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const [height, setHeight] = useState(FRAME_MIN_HEIGHT);
    const trackerRef = useRef(createMixFrameHeightTracker(FRAME_MIN_HEIGHT));
    const heightRef = useRef(FRAME_MIN_HEIGHT);
    // 回调放进 ref：量高的监听只挂一次，不因为父组件换了个新函数就重挂
    const onHeightRef = useRef(onHeight);
    useEffect(() => { onHeightRef.current = onHeight; }, [onHeight]);

    const srcDoc = useMemo(() => {
        // 默认浅色字 + 透明底：内容浮在深色封面蒙版上直接可读，作者可全量覆盖
        const base = /<html[\s>]/i.test(html)
            ? html
            : `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{margin:0;color:#f2f0f7;font:14px/1.8 system-ui,-apple-system,sans-serif;background:transparent;word-break:break-word}</style></head><body>${html}</body></html>`;
        const bridge = `<script>(function(){
  var frameId=${JSON.stringify(frameId)};
  function measure(){var b=document.body;if(!b)return ${FRAME_MIN_HEIGHT};var r=b.getBoundingClientRect();var h=r.height;
    for(var i=0;i<b.children.length;i++){var c=b.children[i].getBoundingClientRect();if(c.width||c.height)h=Math.max(h,c.bottom-r.top);}
    return Math.max(Math.ceil(h),${FRAME_MIN_HEIGHT});}
  function send(){parent.postMessage({source:'mix-rich-frame',type:'resize',id:frameId,height:measure()},'*');}
  function sched(){requestAnimationFrame(function(){send();requestAnimationFrame(send);});}
  window.addEventListener('load',sched);window.addEventListener('resize',sched);
  if(window.MutationObserver)new MutationObserver(sched).observe(document.documentElement,{attributes:true,childList:true,subtree:true,characterData:true});
  setTimeout(send,60);setTimeout(send,400);
})();</` + `script>`;
        return /<\/body>/i.test(base) ? base.replace(/<\/body>/i, `${bridge}</body>`) : base + bridge;
    }, [html, frameId]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
            const data = event.data as Record<string, unknown> | null;
            if (!data || data.source !== "mix-rich-frame" || data.type !== "resize" || data.id !== frameId) return;
            const applied = nextMixFrameHeight(trackerRef.current, Number(data.height), {
                min: FRAME_MIN_HEIGHT,
                max: FRAME_MAX_HEIGHT,
            });
            // 只在高度真的变了才通知外面。画布里的动效会让 MutationObserver 一直重报，
            // 每次都回调的话，外面的「保持滚动落点」会被反复触发，用户手动翻页会被拽回去。
            if (applied === null || applied === heightRef.current) return;
            heightRef.current = applied;
            setHeight(applied);
            onHeightRef.current?.(applied);
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [frameId]);

    return (
        <iframe
            ref={iframeRef}
            title="富文本"
            sandbox="allow-scripts"
            scrolling="no"
            srcDoc={srcDoc}
            style={{
                width: "100%",
                height,
                border: 0,
                display: "block",
                background: "transparent",
                pointerEvents: inert ? "none" : "auto",
            }}
        />
    );
}

/**
 * inert：放在按钮里当预览用（开场白选择），让点击穿给外层。
 * onHeight：画布量好高度、宿主撑开 iframe 之后回调一次（高度真变了才回调）。
 * 开场画布是异步撑高的，外面若要维持滚动落点，必须等这一下再落一次。
 */
export function MixRichText({ text, inert, onHeight }: { text: string; inert?: boolean; onHeight?: (height: number) => void }) {
    if (mixTextHasHtml(text)) return <RichFrame html={text} inert={inert} onHeight={onHeight} />;
    return <div className="mix-detail-value">{text}</div>;
}
