"use client";

// 独家特调 · 创作工坊预览：小票 / 装饰 / 尾调 三类"要眼见为实"的材料，
// 在编辑器里就地试穿——小票喂示例数据渲染，装饰套在样例正文上，尾调进沙盒跑。

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, X } from "lucide-react";
import { MixProseView } from "./prose-view";
import { MixRichText } from "./rich-text";
import { MixTicketFrame } from "./ticket-frame";
import { scopeMixCss } from "@/lib/mixology/css-scope";

/** 装饰预览用的样例正文：覆盖五种正文标记，方便作者一眼看全 */
const GARNISH_SAMPLE = [
    "【便利店 · 打烊前十分钟】",
    "他把最后一排关东煮的竹签码齐，抬眼看见你还站在门口没走。",
    "「伞带了吗。」不是问句，是陈述。*每次都这样，明知故问。*",
    "外头的雨把整条街敲得发亮，~只剩这一盏灯还醒着~。",
].join("\n");

export type MixPreviewTarget =
    | { kind: "ticket"; html: string; raw: string }
    | { kind: "garnish"; css: string }
    | { kind: "encore"; html: string; raw?: string }
    | { kind: "canvas"; html: string; cover?: string };

/** 预览内容本体：四类材料各自的"眼见为实" */
function MixPreviewBody({ target }: { target: MixPreviewTarget }) {
    return (
        <>
        {target.kind === "ticket" ? (
            target.raw.trim() ? (
                <>
                    <div className="mix-detail-label">用「预览示例数据」渲染的效果</div>
                    <div className="mix-ticket-wrap" style={{ marginTop: 8 }}>
                        <MixTicketFrame html={target.html} raw={target.raw} />
                    </div>
                </>
            ) : (
                <div className="mix-comment-empty">
                    先在「预览示例数据」里写几行示例，
                    <br />
                    这里就能看到小票渲染成什么样。
                </div>
            )
        ) : null}

        {target.kind === "garnish" ? (
            <>
                <div className="mix-detail-label">套在样例正文上的效果</div>
                {/* 试穿也走同一套收口，所见即对局里的实际效果 */}
                <div className="mix-garnish-stage mix-garnish-scope">
                    <style>{scopeMixCss(target.css)}</style>
                    <MixProseView text={GARNISH_SAMPLE} />
                    <div className="mix-user-turn">
                        <div className="mix-user-bubble">我把伞递过去，「一起走？」</div>
                    </div>
                </div>
                <div className="mix-detail-label" style={{ marginTop: 14 }}>可用的官方类名</div>
                <div className="mix-detail-value" data-code="true">
                    {[
                        ".mix-prose    正文容器（默认 14px / 行高 1.75）",
                        ".mix-para     普通段落（默认首行缩进 2em，不想缩写 text-indent: 0）",
                        ".mix-scene    场景过场行（【】）",
                        ".mix-dialogue 对白（「」）",
                        ".mix-thought  心声（* *）",
                        ".mix-accent   强调（~ ~）",
                        ".mix-narration 叙述",
                        ".mix-user-bubble 玩家气泡",
                        ".mix-ticket-wrap 小票外框",
                        "",
                        "body / html / :root  等同于整个对局画面",
                        "样式只在对局画面内生效，改不到应用的其他页面",
                    ].join("\n")}
                </div>
            </>
        ) : null}

        {target.kind === "canvas" ? (
            <>
                <div className="mix-detail-label">铺在封面蒙版上的效果</div>
                <div
                    className="mix-canvas-stage"
                    style={target.cover ? { backgroundImage: `url(${target.cover})` } : undefined}
                >
                    <div className="mix-canvas-stage-body">
                        <MixRichText text={target.html} />
                    </div>
                </div>
            </>
        ) : null}

        {target.kind === "encore" ? (
            <>
                <div className="mix-detail-label">{target.raw?.trim() ? "用「预览示例数据」渲染的效果" : "静态小品的运行效果"}</div>
                <div style={{ marginTop: 8, borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.03)" }}>
                    <MixTicketFrame html={target.html} raw={target.raw ?? ""} />
                </div>
            </>
        ) : null}
        </>
    );
}

/** 取一个能代表"内容变了"的键：用来给刷新做去抖，避免每敲一个字就重建沙盒 */
function previewKey(target: MixPreviewTarget): string {
    switch (target.kind) {
        case "ticket": return `t${target.html}${target.raw}`;
        case "garnish": return `g${target.css}`;
        case "encore": return `e${target.html}${target.raw ?? ""}`;
        case "canvas": return `c${target.html}${target.cover ?? ""}`;
    }
}

/**
 * 就地展开的预览：按钮点一下在下面直接铺开，不再弹窗。
 * 弹窗盖在整页上，作者一边改一边看时得反复开关，还容易根本没注意到它弹出来了。
 */
export function MixPreviewInline({
    label,
    target,
    disabled,
}: {
    label: string;
    target: MixPreviewTarget;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    // 展开后是一直看得见的，若每次按键都重建 srcDoc，iframe 会不停闪。
    // 停手 400ms 再跟上：既是活的预览，也不闪。
    const [shown, setShown] = useState<MixPreviewTarget | null>(null);
    const latest = useRef(target);
    latest.current = target;
    const panelRef = useRef<HTMLDivElement | null>(null);
    const key = previewKey(target);

    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => setShown(latest.current), 400);
        return () => window.clearTimeout(timer);
    }, [open, key]);

    // 按钮可能正好在视口最下缘，展开的东西在屏幕外——那又变成"没注意到"了
    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => {
            panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 60);
        return () => window.clearTimeout(timer);
    }, [open]);

    // 内容被清空时收起，免得留一块空面板
    useEffect(() => {
        if (disabled && open) setOpen(false);
    }, [disabled, open]);

    return (
        <div className="mix-preview-inline">
            <button
                type="button"
                className="mix-pill-btn"
                data-open={open ? "true" : undefined}
                aria-expanded={open}
                onClick={() => {
                    if (!open) setShown(latest.current);
                    setOpen((prev) => !prev);
                }}
                disabled={disabled}
            >
                <Play size={13} style={{ verticalAlign: "-2px" }} /> {label}
                <ChevronDown size={13} className="mix-preview-caret" style={{ verticalAlign: "-2px" }} />
            </button>
            {open && shown ? (
                <div className="mix-preview-panel" ref={panelRef}>
                    <MixPreviewBody target={shown} />
                </div>
            ) : null}
        </div>
    );
}

// ── 提示词结构速查 ──
// 让作者知道自己写的东西最终落在提示词的哪一段、和别的材料怎么排队。

const STRUCTURE_ROWS: { section: string; from: string; kind?: string }[] = [
    { section: "（固定开场说明）", from: "系统自带，声明这是角色扮演、越靠后优先级越高" },
    { section: "## 扮演总纲", from: "基底", kind: "base" },
    { section: "## 角色资料", from: "角色卡：角色名 / 基础信息 / 性格 / 外貌 / 背景", kind: "character" },
    { section: "## 用户资料", from: "面具：代入名 + 用户人设（写了才有这一段）", kind: "persona" },
    { section: "## 世界与剧情", from: "角色卡：世界观 / 初始认知 / 关系与身份 / 当前剧情 / 附加设定", kind: "character" },
    { section: "## 文风", from: "风味", kind: "flavor" },
    { section: "## 正文输出要求", from: "内置正文标记规则（在前）+ 杯型内容（在后）", kind: "glass" },
    { section: "## 状态栏", from: "小票的输出契约（格式说明在前、内容要求在后，壳为 [状态栏]...[/状态栏]）", kind: "ticket" },
    { section: "## 小剧场", from: "尾调的输出契约（写了契约才有这一段，壳为 [小剧场]...[/小剧场]）", kind: "encore" },
    { section: "## 示例对话", from: "角色卡：示例对话", kind: "character" },
    { section: "## 输出格式检查", from: "系统自带的收尾核对清单（带状态栏/小剧场时出现）" },
];

export function MixStructureSheet({ highlight, onClose }: { highlight?: string; onClose: () => void }) {
    return (
        <div className="mix-sheet-mask" onClick={onClose}>
            <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="mix-sheet-head">
                    <div className="mix-sheet-title">提示词结构</div>
                    <button type="button" className="mix-icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
                </div>
                <div className="mix-sheet-body">
                    <div className="mix-struct-note">
                        标题用 Markdown 二级标题（<code>##</code>）。<b>没填的字段整段消失</b>，不会留空壳标题；
                        文本里的 <code>{"{{char}}"}</code> / <code>{"{{user}}"}</code> 装配时会换成角色名和玩家代入名。
                        <br />
                        另外，<b>吧台上的叫法只给你看</b>——基底、杯型、小票这些比喻词不会出现在提示词里，
                        发给模型的一律是「扮演总纲」「正文输出要求」「状态栏」这种它一眼能懂的说法。
                    </div>

                    <div className="mix-detail-label" style={{ marginTop: 14 }}>系统提示词（对话历史之前）</div>
                    <div className="mix-struct-list">
                        {STRUCTURE_ROWS.map((row) => (
                            <div className="mix-struct-row" data-on={highlight && row.kind === highlight ? "true" : undefined} key={row.section}>
                                <div className="mix-struct-section">{row.section}</div>
                                <div className="mix-struct-from">← {row.from}</div>
                            </div>
                        ))}
                    </div>

                    <div className="mix-struct-divider">［ 对话历史 ］</div>

                    <div className="mix-struct-list">
                        <div className="mix-struct-row" data-on={highlight === "strength" ? "true" : undefined}>
                            <div className="mix-struct-section">【最高优先级要求】</div>
                            <div className="mix-struct-from">← 苦精（唯一放在历史之后的部分，离生成最近、最难被忘）</div>
                        </div>
                    </div>

                    <div className="mix-struct-divider">［ 本轮生成 ］</div>

                    <div className="mix-detail-label" style={{ marginTop: 16 }}>不进提示词的部分</div>
                    <div className="mix-struct-note" data-on={highlight === "filter" ? "true" : undefined}>
                        <b>外观</b>的 CSS、<b>小票与尾调</b>的渲染代码、<b>开场画布</b>都只在界面里执行，
                        不发给模型，写多长都不占上下文。<b>开场白</b>也不在系统提示词里，它作为对局的第一条角色消息单独送出。
                        <b>滤网</b>的正则规则在回复拆完状态栏/小剧场之后清洗正文——「仅显示」只影响渲染，
                        「进上下文」会洗过再入库（发回模型的历史随之变干净），两种都不进提示词。
                    </div>
                </div>
            </div>
        </div>
    );
}
