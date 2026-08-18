// lib/mixology/types.ts
// 独家特调 · 领域类型：材料（七类）、特调方案、对局。
//
// 心智模型：角色卡也是一种材料；玩家把材料收进酒柜，在吧台给每个槽位
// 各挑一件调成「特调」，特调可命名保存/分享。对局 = 角色卡 + 特调的一次运行。
// 本文件只定义数据形状，装配见 assembler.ts，存取见 storage.ts。

/** 材料十类（槽位一一对应） */
export type MixMaterialKind =
    | "character" // 角色卡
    | "persona"   // 面具：用户人设（{{user}} 的名字与设定）
    | "base"      // 基底：扮演总纲
    | "flavor"    // 风味：文风
    | "glass"     // 杯型：输出格式
    | "strength"  // 苦精：尾部强化（离生成最近、权重最高）
    | "ticket"    // 小票：状态数据卡（输出契约 + 渲染代码）
    | "garnish"   // 外观：界面美化 CSS
    | "encore"    // 尾调：随卡互动 HTML 小品
    | "filter"    // 滤网：正则清洗正文（不进提示词）
    | "mechanism"; // 机括：沙盒里跑的钩子逻辑 + 常驻界面

export const MIX_KIND_LABELS: Record<MixMaterialKind, string> = {
    character: "角色卡",
    persona: "面具",
    base: "基底",
    flavor: "风味",
    glass: "杯型",
    strength: "苦精",
    ticket: "小票",
    garnish: "外观",
    encore: "尾调",
    filter: "滤网",
    mechanism: "机括",
};

/** 吧台槽位顺序（角色卡永远第一槽） */
export const MIX_SLOT_ORDER: MixMaterialKind[] = [
    "character", "persona", "base", "flavor", "glass", "strength", "ticket", "garnish", "encore", "filter", "mechanism",
];

/** TAB 上大字下面那行小字：说明这一类到底干什么（不进提示词的种类标它的实际职责） */
export const MIX_KIND_SECTION_LABELS: Record<MixMaterialKind, string> = {
    character: "角色资料",
    persona: "用户资料",
    base: "扮演总纲",
    flavor: "文风",
    glass: "正文输出要求",
    strength: "最高优先级",
    ticket: "状态栏",
    garnish: "界面样式",
    encore: "小剧场",
    filter: "正则替换",
    mechanism: "可执行逻辑",
};

/** 必选槽：没配齐不能开局；其余槽可留空 */
export const MIX_REQUIRED_KINDS: MixMaterialKind[] = ["character"];

/** 一格最多叠几件 */
export const MIX_SLOT_MAX = 3;

/**
 * 叠放语义：
 * concat = 这一格里条件满足的全部生效，按顺序依次拼接（多段文风叠加、主装饰 + 补丁装饰）；
 * first  = 只用第一件条件满足的（状态卡只能有一张、小剧场一轮只演一出）。
 */
export const MIX_SLOT_STACK: Record<MixMaterialKind, "concat" | "first"> = {
    character: "first",
    persona: "first",
    base: "concat",
    flavor: "concat",
    glass: "concat",
    strength: "concat",
    ticket: "first",
    garnish: "concat",
    encore: "first",
    filter: "concat",
    mechanism: "concat",
};

/** 不给设生效条件的格：这两格没了这一局就不成立 */
export const MIX_NO_CONDITION_KINDS: MixMaterialKind[] = ["character", "persona"];

/**
 * 会在下载方设备上「按轮执行、且能改写对话」的材料。
 * 小票与尾调也带 JS，但它们只在沙盒 iframe 里画自己那一块，动不了对话内容；
 * 机括不一样——它能改你发出去的话、改你看到的正文、以你的身份发言，
 * 所以上架与入柜两头都要单独说明白，不能混在普通材料里悄悄过。
 */
export const MIX_ACTIVE_CODE_KINDS: MixMaterialKind[] = ["mechanism"];

export function mixKindRunsActiveCode(kind: MixMaterialKind): boolean {
    return MIX_ACTIVE_CODE_KINDS.includes(kind);
}

export function mixKindAllowsCondition(kind: MixMaterialKind): boolean {
    return !MIX_NO_CONDITION_KINDS.includes(kind);
}

/**
 * 支持配图的种类：角色卡 + 三类"看效果"的视觉材料（小票/装饰/尾调），
 * 列表里走双列海报瀑布；其余纯文本材料不配图，走单列列表。
 */
export const MIX_VISUAL_KINDS: MixMaterialKind[] = ["character", "ticket", "garnish", "encore"];

export function mixKindHasCover(kind: MixMaterialKind): boolean {
    return MIX_VISUAL_KINDS.includes(kind);
}

/** 一件材料最多几个标签 / 每个标签最长几个字：与云端 normalizeTags 同口径 */
export const MIX_TAG_MAX = 8;
export const MIX_TAG_LEN = 24;

/**
 * 标签规整：去空白、去重、掐长度、掐个数。
 * 本地和云端必须同一套口径——否则本地看着有九个标签，发布上去只剩八个，
 * 作者会以为发布把标签吞了。
 */
export function normalizeMixTags(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") continue;
        const tag = item.trim().replace(/\s+/g, " ").slice(0, MIX_TAG_LEN);
        if (!tag || out.includes(tag)) continue;
        out.push(tag);
        if (out.length >= MIX_TAG_MAX) break;
    }
    return out;
}

/** 编辑器里一行文本拆成标签：逗号、顿号、竖线、井号、空格都算分隔 */
export function parseMixTags(text: string): string[] {
    return normalizeMixTags(text.split(/[,，、|｜#＃\s]+/));
}

/** 标签回填到编辑器那一行文本 */
export function formatMixTags(tags: string[] | undefined): string {
    return (tags ?? []).join("、");
}

/** 所有材料共有的元信息 */
export type MixMaterialMeta = {
    id: string;
    kind: MixMaterialKind;
    name: string;
    /** 一句话介绍（列表页钩子文案） */
    hook?: string;
    /** 创作者署名（本地自建可空） */
    author?: string;
    /** 创作者头像 dataURL：入柜时随线上条目带回；自己的材料展示本地创作者资料，不用这个字段 */
    authorAvatar?: string;
    tags?: string[];
    /** 封面图 dataURL 或远端地址（角色卡强烈建议有） */
    cover?: string;
    /** 已上架到酒材页时的线上 id：有它才谈得上"更新已发布版本" */
    publishedId?: string;
    /** 最近一次同步到云端成功时的 updatedAt 快照；本地 updatedAt 比它新 = 有未上架修改 */
    publishedAt?: number;
    /**
     * 来自酒材页/配方页的别人的作品。与应用市场、游戏大厅同规矩：
     * 能拿来开局，但站内不展示正文、不能编辑、不能导出、不能二次发布。
     */
    imported?: boolean;
    createdAt: number;
    updatedAt: number;
};

/** 角色卡：AI 读的字段全部可选（空字段装配时整段消失），只有名字必填 */
export type MixCharacterCard = MixMaterialMeta & {
    kind: "character";
    /** 角色名（对局中的 {{char}}） */
    charName: string;
    /** 基础信息：年龄/身高/职业等，自由文本或键值行 */
    baseInfo?: string;
    personality?: string;
    appearance?: string;
    background?: string;
    /** 世界观：所处世界的公共设定 */
    worldview?: string;
    /** 对 user 的初始认知：开局时角色"知道"user 什么 */
    cognition?: string;
    /** 关系与身份推荐：user 可代入哪些身份、各身份下关系如何 */
    relations?: string;
    /** 当前剧情：开局时间点的情境 */
    plot?: string;
    /** 开场白（可多个，玩家开局挑一个；纯文本，进对局与提示词） */
    openings: string[];
    /** 开场画布：点进卡详情时铺在封面蒙版上的门面页（HTML，沙盒渲染，不进提示词） */
    canvas?: string;
    /** 示例对话：文风锚点（user/char 轮次） */
    examples?: { role: "user" | "char"; text: string }[];
    /** 附加设定：NPC、私设名词表等自由区 */
    extra?: string;
    /** @deprecated 已被开场画布取代，仅为兼容旧数据保留 */
    authorNote?: string;
};

/** 纯文本类材料：基底 / 风味 / 杯型 / 苦精 */
export type MixTextMaterial = MixMaterialMeta & {
    kind: "base" | "flavor" | "glass" | "strength";
    content: string;
};

/** 面具（用户人设）：{{user}} 是谁——代入名 + 人设正文，装配成「用户资料」段 */
export type MixPersonaMaterial = MixMaterialMeta & {
    kind: "persona";
    /** 玩家代入名，替换 {{user}}；留空用默认「你」 */
    userName?: string;
    content: string;
};

/**
 * 小票里被标成「记住」的一项：每轮从小票原文里按键名抽出来，跨轮留存。
 * 抽不到就保留上一轮的值——宁可停滞，不能跳变。
 */
export type MixTicketVar = {
    /** 变量名，同时就是小票原文里的键名 */
    name: string;
    /** 开局时的初始值 */
    initial?: string;
};

/** 小票：输出契约进提示词，渲染代码在沙盒 iframe 接管展示 */
export type MixTicketMaterial = MixMaterialMeta & {
    kind: "ticket";
    /** 告诉 AI 每轮在 [小票] 壳内输出什么 */
    contract: string;
    /** 完整 HTML（可含 JS），数据经 window.TICKET_RAW / {{RAW}} 注入 */
    renderHtml: string;
    /** 编辑器预览用示例数据 */
    previewRaw?: string;
    /** 这张小票里哪几项要记住（记住的值可被条件判断、可被 {{状态.X}} 取用） */
    vars?: MixTicketVar[];
};

/** 外观：对局界面美化（官方语义类 + 界面定位符的 CSS） */
export type MixGarnishMaterial = MixMaterialMeta & {
    kind: "garnish";
    css: string;
};

/** 尾调（小剧场）：AI 按契约输出加演内容，渲染代码负责画出来；契约留空则为纯静态小品 */
export type MixEncoreMaterial = MixMaterialMeta & {
    kind: "encore";
    /** 告诉 AI 小剧场何时出现、写什么；留空则不进提示词，渲染代码作为静态小品直接展示 */
    contract?: string;
    /** 完整 HTML（可含 JS），AI 输出经 window.ENCORE_RAW / {{RAW}} 注入 */
    renderHtml?: string;
    /** @deprecated 旧字段（纯静态 HTML），读取时等价于 renderHtml */
    html?: string;
    /** 编辑器预览用示例数据 */
    previewRaw?: string;
};

/** 尾调渲染代码：新旧字段统一出口 */
export function mixEncoreRenderHtml(material: MixEncoreMaterial): string {
    return material.renderHtml ?? material.html ?? "";
}

/** 滤网单条规则：正则查找 + 替换文本 + 作用模式 */
export type MixFilterRule = {
    /** 查找（JS 正则，自动带 g 标志） */
    find: string;
    /** 替换文本（支持 $1 等捕获组引用；空串即删除） */
    replace: string;
    /**
     * display = 仅显示：存的和发给模型的都是原文，只在渲染前替换，对全部历史即时生效；
     * context = 进上下文：回复拆完块后清洗一遍再入库，历史发回模型的是洗过的，只对新回复生效。
     */
    mode: "display" | "context";
};

/** 滤网：对 AI 正文做正则清洗（拆完状态栏/小剧场块之后才执行，不碰块数据，不进提示词） */
export type MixFilterMaterial = MixMaterialMeta & {
    kind: "filter";
    rules: MixFilterRule[];
};

/** 机括的停靠位：界面挂在对局画面的哪一侧，位置由应用排布，创作者只能选 */
export type MixDock = "left" | "right" | "bottom" | "float";

export const MIX_DOCK_LABELS: Record<MixDock, string> = {
    left: "左侧栏",
    right: "右侧栏",
    bottom: "底部条",
    float: "悬浮球",
};

/**
 * 机括：两个部分，任一半可留空。
 * - 钩子：在流水线的固定几个口子上被叫起来跑一下，收数据包、还数据包，
 *   跑在没有网络、碰不到宿主页面的沙盒里，还带超时熔断。
 * - 常驻界面：选一个停靠位挂一段 HTML，跨轮活着、有自己的存储。
 * 两半共用同一个存储桶，天然能互相看见。
 */
export type MixMechanismMaterial = MixMaterialMeta & {
    kind: "mechanism";
    /** 钩子代码：定义 onSessionStart / onBeforeSend / onAfterReply / onSessionEnd */
    script?: string;
    /** 常驻界面的停靠位；不填则这件机括没有界面 */
    dock?: MixDock;
    /** 常驻界面的 HTML（含 CSS/JS），在沙盒 iframe 里跑 */
    panelHtml?: string;
};

export type MixMaterial =
    | MixCharacterCard
    | MixPersonaMaterial
    | MixTextMaterial
    | MixTicketMaterial
    | MixGarnishMaterial
    | MixEncoreMaterial
    | MixFilterMaterial
    | MixMechanismMaterial;

/** 条件里的比较符 */
export type MixCompareOp = ">" | ">=" | "<" | "<=" | "=" | "!=";

/**
 * 一件材料的生效条件。不写 = 一直生效。
 * 刻意只做「一句话能说清」的四种，不支持嵌套、不做表达式求值——
 * 条件是纯数据，跟着材料分享出去也不会执行任何东西。
 */
export type MixCondition =
    /** 聊到第 N 轮之后 */
    | { type: "turn"; after: number }
    /** 记住的某个值满足比较（数字按数字比，其余按文字比） */
    | { type: "var"; name: string; op: MixCompareOp; value: string }
    /** 最近 within 轮里提到过其中任一个词（默认只看最近 1 轮） */
    | { type: "keyword"; words: string[]; within?: number }
    /** 随机 percent% 的轮次生效 */
    | { type: "chance"; percent: number };

/** 配方里的一条材料：材料 id + 生效条件 */
export type MixSlotEntry = {
    materialId: string;
    when?: MixCondition;
};

/** 对局记住的值：可能是数字（好感度 61），也可能是文字（时段 深夜） */
export type MixStateValue = string | number;
export type MixState = Record<string, MixStateValue>;

/** 兼容早期数据：那时一格只放一件，槽位存的是材料 id 字符串 */
export type MixSlotsRaw = Partial<Record<MixMaterialKind, string | MixSlotEntry[]>>;

/** 读一格里的材料清单（吃得下新旧两种形状） */
export function mixSlotEntries(slots: MixSlotsRaw | undefined, kind: MixMaterialKind): MixSlotEntry[] {
    const raw = slots?.[kind];
    if (!raw) return [];
    if (typeof raw === "string") return [{ materialId: raw }];
    return raw.filter((entry) => entry && typeof entry.materialId === "string" && entry.materialId);
}

/** 一格里第一件材料的 id（角色卡、面具这种单件格用） */
export function mixSlotFirstId(slots: MixSlotsRaw | undefined, kind: MixMaterialKind): string | undefined {
    return mixSlotEntries(slots, kind)[0]?.materialId;
}

/** 把任意形状的槽位统一成新形状（读盘时做一次，之后全程按新形状走） */
export function normalizeMixSlots(slots: MixSlotsRaw | undefined): Partial<Record<MixMaterialKind, MixSlotEntry[]>> {
    const out: Partial<Record<MixMaterialKind, MixSlotEntry[]>> = {};
    for (const kind of MIX_SLOT_ORDER) {
        const entries = mixSlotEntries(slots, kind).slice(0, MIX_SLOT_MAX);
        if (entries.length) out[kind] = entries;
    }
    return out;
}

/** 特调方案：每个槽位记录所用材料（材料本体在酒柜里） */
export type MixRecipe = {
    id: string;
    name: string;
    /** kind → 这一格叠的材料（有序，最多 MIX_SLOT_MAX 件）；角色卡必有，其余可缺 */
    slots: Partial<Record<MixMaterialKind, MixSlotEntry[]>>;
    /** 作者署名与头像：从配方页入柜时带回；自己的配方展示本地创作者资料 */
    author?: string;
    authorAvatar?: string;
    /** 已上架到配方页时的线上 id */
    publishedId?: string;
    /** 最近一次同步到云端成功时的 updatedAt 快照 */
    publishedAt?: number;
    /** 从配方页导入的别人的配方：不能二次发布 */
    imported?: boolean;
    createdAt: number;
    updatedAt: number;
};

/** 对局消息 */
export type MixTurn = {
    id: string;
    role: "user" | "assistant";
    /** 正文（assistant 侧已剥离小票块） */
    text: string;
    /** 该轮小票壳内原文（有小票材料且 AI 按契约输出时才有） */
    ticketRaw?: string;
    /** 该轮小剧场壳内原文（尾调写了契约且 AI 输出时才有） */
    encoreRaw?: string;
    /**
     * 这一轮结束时记住的值。回溯 / 重说 / 编辑某轮之后，
     * 直接取剩下最后一轮的这份快照还原，数字不会停留在被丢掉的未来。
     */
    state?: MixState;
    createdAt: number;
};

/** 对局：一次「角色卡 + 特调」的运行 */
export type MixSession = {
    id: string;
    /** 开局时的方案快照（防止事后改方案影响旧局回放语义） */
    recipe: MixRecipe;
    /** 角色名快照（列表展示用，酒柜里的卡被删也不受影响） */
    charName: string;
    /** 玩家代入名（{{user}}），空则用默认 */
    userName?: string;
    /** 选用的开场索引 */
    openingIndex: number;
    turns: MixTurn[];
    /** 当前记住的值（小票里勾了「记住」的项，每轮更新） */
    state?: MixState;
    /**
     * 每件机括自己的存储桶（materialId → 键值表），退出再进来还在。
     * 刻意不随轮次做快照：存储桶上限给到 100KB，逐轮留档会把对局撑爆。
     * 回溯之后机括看到的还是回溯前的私有记忆——数据包里带了 turnCount，
     * 需要的话机括可以自己发现轮数倒退并复位。
     */
    mechanismStore?: Record<string, Record<string, string>>;
    createdAt: number;
    updatedAt: number;
};

/**
 * 与云端的关联状态（参考应用市场的显式同步模型）：
 * local = 没上架过；synced = 已上架且本地无改动；dirty = 已上架但本地改动还没同步。
 * 同步是显式动作——本地保存永远不自动推云端，云端也不会反向覆盖本地。
 */
export function mixCloudState(item: { publishedId?: string; publishedAt?: number; updatedAt: number }): "local" | "synced" | "dirty" {
    if (!item.publishedId) return "local";
    if (!item.publishedAt || item.updatedAt > item.publishedAt) return "dirty";
    return "synced";
}

/** 生成短 id（本地实体通用） */
export function createMixId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
