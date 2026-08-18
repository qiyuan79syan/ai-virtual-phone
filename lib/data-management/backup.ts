import JSZip from "jszip";
import { downloadFile, type DownloadFileOptions } from "../download-utils";
import { DATA_MODULES } from "./modules";
import { clearSource, exportSource, importSource, inspectSource } from "./idb";
import { createMediaCollector, estimateValueBytes, utf8Bytes, type MediaCollector, type MediaResolver } from "./serializers";
import type {
  BackupEnvelope,
  BackupManifest,
  ClearResult,
  DataModuleId,
  DataSnapshot,
  ImportOptions,
  ImportResult,
  ModulePayload,
  ModuleStats,
  SourceBackup,
} from "./types";

const BACKUP_FILE_VERSION = 2;                       // new backups: media stored as binary entries
const SUPPORTED_BACKUP_VERSIONS = new Set<number>([1, 2]); // still restore old base64 (v1) backups

function getSelectedModules(moduleIds?: DataModuleId[]) {
  if (!moduleIds || moduleIds.length === 0) return DATA_MODULES;
  const selected = new Set(moduleIds);
  return DATA_MODULES.filter((module) => selected.has(module.id));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export async function inspectData(): Promise<DataSnapshot> {
  const moduleStats: ModuleStats[] = [];
  let totalBytes = 0;
  let totalRecords = 0;

  for (const dataModule of DATA_MODULES) {
    let records = 0;
    let bytes = 0;
    const details: ModuleStats["details"] = [];
    for (const source of dataModule.sources) {
      const stats = await inspectSource(source);
      records += stats.records;
      bytes += stats.bytes;
      details.push(...(stats.details ?? []));
    }
    totalBytes += bytes;
    totalRecords += records;
    moduleStats.push({
      moduleId: dataModule.id,
      label: dataModule.label,
      description: dataModule.description,
      variant: dataModule.variant,
      records,
      bytes,
      percent: 0,
      critical: Boolean(dataModule.critical),
      large: Boolean(dataModule.large),
      details: details.sort((a, b) => b.bytes - a.bytes),
    });
  }

  for (const stats of moduleStats) {
    stats.percent = totalBytes > 0 ? Math.round((stats.bytes / totalBytes) * 100) : 0;
  }

  const storage = typeof navigator !== "undefined" && navigator.storage
    ? {
        ...(await navigator.storage.estimate().catch(() => ({}))),
        persisted: await navigator.storage.persisted().catch(() => undefined),
      }
    : undefined;

  return {
    totalBytes,
    totalRecords,
    modules: moduleStats,
    storage,
    createdAt: new Date().toISOString(),
  };
}

export type BackupOptions = {
  /** Strip embedded images/audio/video (keeps text/config/structure + avatars). */
  excludeMedia?: boolean;
};

// Modules whose media is kept even in "exclude media" mode (avatars are identity).
const MEDIA_KEEP_MODULE_IDS = new Set<DataModuleId>(["characters"]);

const MEDIA_DATAURL_RE = /^data:(?:image|audio|video|application\/octet-stream)/i;
const MEDIA_MIN_BYTES = 2048;

function stripMediaDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MEDIA_MIN_BYTES && MEDIA_DATAURL_RE.test(value) ? "" : value;
  }
  if (Array.isArray(value)) return value.map(stripMediaDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripMediaDeep(v);
    return out;
  }
  return value;
}

// KV / localStorage values are JSON strings; parse, strip nested data-URLs, re-stringify.
function stripMediaInString(value: string): string {
  if (typeof value !== "string" || value.length <= MEDIA_MIN_BYTES) return value;
  if (MEDIA_DATAURL_RE.test(value)) return "";
  if (/"data:(?:image|audio|video)/i.test(value)) {
    try { return JSON.stringify(stripMediaDeep(JSON.parse(value))); } catch { return value; }
  }
  return value;
}

function stripMediaFromSource(payload: SourceBackup): SourceBackup {
  if (payload.type === "indexeddb") {
    return {
      ...payload,
      stores: payload.stores.map((store) => ({
        ...store,
        records: store.records.map((record) => ({ ...record, value: stripMediaDeep(record.value) })),
      })),
    };
  }
  return {
    ...payload,
    records: payload.records.map((record) => ({ ...record, value: stripMediaInString(record.value) })),
  };
}


/** 从模块 payload 收集告警：数据源导出失败、关键模块 0 记录（很可能是坏备份） */
function collectModuleWarnings(dataModule: ReturnType<typeof getSelectedModules>[number], payload: ModulePayload, records: number): string[] {
  const warnings: string[] = [];
  for (const sourcePayload of payload.sources) {
    if (sourcePayload.type === "indexeddb" && sourcePayload.error) {
      warnings.push(`「${dataModule.label}」${sourcePayload.error}`);
    }
  }
  if (dataModule.critical && records === 0) {
    warnings.push(`「${dataModule.label}」导出了 0 条记录——如果这台设备上有过这类数据，说明备份不完整，请勿依赖。`);
  }
  return warnings;
}

export async function buildBackupEnvelope(moduleIds?: DataModuleId[], options: BackupOptions = {}): Promise<BackupEnvelope> {
  return buildEnvelope(moduleIds, options);
}

/** Module list for streaming (one-at-a-time) backup builds — see buildSingleModulePayload. */
export function getBackupModules(moduleIds?: DataModuleId[]) {
  return getSelectedModules(moduleIds);
}

/**
 * Build ONE module's payload. Lets callers stream "read → compress → upload →
 * release" per module instead of holding every module's data (objects + JSON
 * strings) in memory at once — the all-at-once peak is what crashes mobile
 * WebKit (page reload) on large libraries. Counts records from the payload
 * itself so callers don't need the double full read of inspectData().
 */
export async function buildSingleModulePayload(
  dataModule: ReturnType<typeof getSelectedModules>[number],
  options: BackupOptions = {},
  collector?: MediaCollector,
): Promise<{ payload: ModulePayload; records: number; warnings: string[] }> {
  const stripping = Boolean(options.excludeMedia) && !MEDIA_KEEP_MODULE_IDS.has(dataModule.id);
  // Stripped modules export media as dataURL strings so stripMediaFromSource can
  // remove it; extracting to media-refs first would make "exclude media" a no-op.
  const moduleCollector = stripping ? undefined : collector;
  let sources: SourceBackup[] = [];
  for (const source of dataModule.sources) {
    sources.push(await exportSource(source, moduleCollector));
  }
  if (stripping) {
    sources = sources.map(stripMediaFromSource);
  }
  let records = 0;
  for (const sourcePayload of sources) {
    if (sourcePayload.type === "indexeddb") {
      for (const store of sourcePayload.stores) records += store.records.length;
    } else {
      records += sourcePayload.records.length;
    }
  }
  const payload: ModulePayload = { moduleId: dataModule.id, sources };
  return { payload, records, warnings: collectModuleWarnings(dataModule, payload, records) };
}

async function buildEnvelope(moduleIds?: DataModuleId[], options: BackupOptions = {}, collector?: MediaCollector): Promise<BackupEnvelope> {
  // 这里刻意不再调 inspectData()：它会把所有库完整读第二遍，只为拿几个统计数字。
  // 记录数从 payload 自己数，字节数用零分配的 estimateValueBytes 量。
  const selectedModules = getSelectedModules(moduleIds);
  const modulePayloads: ModulePayload[] = [];
  const manifestModules: BackupManifest["modules"] = [];

  for (const dataModule of selectedModules) {
    const built = await buildSingleModulePayload(dataModule, options, collector);
    modulePayloads.push(built.payload);
    manifestModules.push({
      id: dataModule.id,
      label: dataModule.label,
      records: built.records,
      bytes: estimateValueBytes(built.payload),
    });
  }

  const manifest: BackupManifest = {
    format: "ai-phone-backup",
    // v2 only when media was actually extracted to binary entries (collector present).
    version: collector ? 2 : 1,
    createdAt: new Date().toISOString(),
    origin: typeof window !== "undefined" ? window.location.origin : "",
    modules: manifestModules,
    totalBytes: manifestModules.reduce((sum, item) => sum + item.bytes, 0),
    totalRecords: manifestModules.reduce((sum, item) => sum + item.records, 0),
    ...(options.excludeMedia ? { mediaExcluded: true } : {}),
  };

  return { manifest, modules: modulePayloads };
}

/**
 * 逐模块流式导出：读一个模块 → 序列化 → 立刻释放对象树 → 转成 Blob 交给 zip →
 * 释放字符串 → 媒体随模块写进 zip → 下一个。云备份（cloud-backup/engine）早就是
 * 这么走的，本地导出此前还是"全部模块读完再一起 stringify 再一起压"，峰值内存能到
 * 数据本身的四五倍——大库用户点导出就闪退（移动端 WebKit 超限直接杀页，不报错）。
 *
 * 关键在于每一步都不让两份大数据同时活着：
 *  - payload 置空后，JSON 字符串是唯一的一份；
 *  - 字符串转成 Blob 后立刻丢掉引用：Blob 由浏览器托管（通常落盘），不占 JS 堆，
 *    否则所有模块的 JSON 会一直堆在堆里直到 generateAsync；
 *  - 媒体每模块写完即从 collector 里松手（zip 自己持有引用），不攒到最后。
 */
export async function createBackupBlob(moduleIds?: DataModuleId[], options: BackupOptions = {}): Promise<{ blob: Blob; manifest: BackupManifest; warnings: string[] }> {
  const zip = new JSZip();
  const selectedModules = getSelectedModules(moduleIds);
  const warnings: string[] = [];
  const manifestModules: BackupManifest["modules"] = [];
  const writtenMedia = new Set<string>();
  let totalRecords = 0;
  let totalBytes = 0;

  for (const dataModule of selectedModules) {
    // 每模块一个 collector。媒体是按内容哈希寻址的，跨模块的同一张图仍然算出同一个
    // ref，靠 writtenMedia 去重，不会因为拆开收集而在包里重复一份。
    const collector = createMediaCollector();
    const built = await buildSingleModulePayload(dataModule, options, collector);
    warnings.push(...built.warnings);
    totalRecords += built.records;

    let json: string | null = JSON.stringify(built.payload);
    built.payload = null as unknown as ModulePayload; // 释放对象树
    const jsonBytes = utf8Bytes(json);
    const moduleBlob = new Blob([json], { type: "application/json" });
    json = null;                                      // 释放 JSON 字符串
    zip.file(`modules/${dataModule.id}.json`, moduleBlob);

    // 媒体单独存二进制条目，一个内容哈希一条。STORE：图片/音频本来就压过了，
    // 再 DEFLATE 只烧 CPU 不省体积。
    let mediaBytes = 0;
    for (const [ref, mediaBlob] of collector.media) {
      mediaBytes += mediaBlob.size;
      if (writtenMedia.has(ref)) continue;
      writtenMedia.add(ref);
      zip.file(`media/${ref}.bin`, mediaBlob, { compression: "STORE" });
    }
    collector.media.clear();                          // zip 已持有引用，这里松手

    manifestModules.push({
      id: dataModule.id,
      label: dataModule.label,
      records: built.records,
      bytes: jsonBytes + mediaBytes,
    });
    totalBytes += jsonBytes + mediaBytes;
  }

  const manifest: BackupManifest = {
    format: "ai-phone-backup",
    version: BACKUP_FILE_VERSION,
    createdAt: new Date().toISOString(),
    origin: typeof window !== "undefined" ? window.location.origin : "",
    modules: manifestModules,
    totalBytes,
    totalRecords,
    ...(options.excludeMedia ? { mediaExcluded: true } : {}),
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const blob = await generateZipBlob(zip);
  return { blob, manifest, warnings };
}

/** 攒到这个量就把已压好的字节交给浏览器托管，JS 堆立刻还回去。 */
const ZIP_FLUSH_BYTES = 8 * 1024 * 1024;

/**
 * 流式收 zip 输出。generateAsync({type:"blob"}) 会把整个压缩结果先在 JS 堆里攒成
 * 一片，几百 MB 的备份到这一步仍可能被系统杀页——前面省下来的全白省。改成边压边把
 * 分片封进 Blob（浏览器通常落盘），堆里任何时刻只留最后不到 8MB。
 */
function generateZipBlob(zip: JSZip): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const parts: Blob[] = [];
    // Cast 同 serializers.bytesToBlob：TS 5.7 把 Uint8Array 标成 <ArrayBufferLike>，
    // BlobPart 要的是 <ArrayBuffer>。
    let pending: BlobPart[] = [];
    let pendingBytes = 0;

    const flush = () => {
      if (pendingBytes === 0) return;
      parts.push(new Blob(pending));
      pending = [];
      pendingBytes = 0;
    };

    try {
      zip.generateInternalStream({ type: "uint8array", compression: "DEFLATE" })
        .on("data", (chunk: Uint8Array) => {
          pending.push(chunk as unknown as BlobPart);
          pendingBytes += chunk.length;
          if (pendingBytes >= ZIP_FLUSH_BYTES) flush();
        })
        .on("error", (error: Error) => reject(error))
        .on("end", () => {
          flush();
          resolve(new Blob(parts, { type: "application/zip" }));
        })
        .resume();
    } catch (error) {
      // 老版本 JSZip 没有 generateInternalStream 时退回一次性生成——慢且吃内存，
      // 但总比导不出来强。
      zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/zip" })
        .then(resolve)
        .catch(() => reject(error));
    }
  });
}

export async function readBackupBlob(blob: Blob): Promise<BackupEnvelope> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("备份文件缺少 manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string")) as BackupManifest;
  if (manifest.format !== "ai-phone-backup" || !SUPPORTED_BACKUP_VERSIONS.has(manifest.version)) {
    throw new Error("备份文件格式不受支持");
  }

  const modules: ModulePayload[] = [];
  const moduleFolder = zip.folder("modules");
  if (!moduleFolder) return { manifest, modules };

  const fileNames = Object.keys(zip.files).filter((name) => name.startsWith("modules/") && name.endsWith(".json"));
  for (const fileName of fileNames) {
    const file = zip.file(fileName);
    if (!file) continue;
    modules.push(JSON.parse(await file.async("string")) as ModulePayload);
  }

  return { manifest, modules };
}

export async function downloadBackupBlob(blob: Blob, manifest: BackupManifest, options: DownloadFileOptions = {}): Promise<void> {
  const date = manifest.createdAt.replace(/[:.]/g, "-").slice(0, 19);
  const zipBlob = blob.type === "application/zip" ? blob : blob.slice(0, blob.size, "application/zip");
  // Plain .zip extension so iOS Safari's file picker recognizes the type and
  // lets the user select it for import (a custom .aiphone extension is greyed
  // out on iOS, which has no UTI for it). The backup is validated by the
  // manifest's format/version on import, not by the file extension.
  await downloadFile(zipBlob, `ai-phone-backup-${date}.zip`, options);
}

export async function importBackupBlob(blob: Blob, moduleIds?: DataModuleId[], options: ImportOptions = {}): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("备份文件缺少 manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string")) as BackupManifest;
  if (manifest.format !== "ai-phone-backup" || !SUPPORTED_BACKUP_VERSIONS.has(manifest.version)) {
    throw new Error("备份文件格式不受支持");
  }

  const selected = moduleIds && moduleIds.length > 0 ? new Set(moduleIds) : null;
  const total: ImportResult = { added: 0, skipped: 0, overwritten: 0, errors: [] };

  // Pull each media binary straight from the zip, one at a time (low peak memory).
  // v1 backups have no media/ entries — markers there are inline base64, resolver is never hit.
  const missingMedia = new Set<string>();
  const resolver: MediaResolver = async (ref) => {
    const file = zip.file(`media/${ref}.bin`);
    if (!file) { missingMedia.add(ref); return null; }
    return await file.async("uint8array");
  };

  // Process modules one at a time — never hold every module's parsed JSON at once
  // (the all-at-once parse of base64-laden modules is what OOM-crashed mobile WebKit).
  const fileNames = Object.keys(zip.files).filter((name) => name.startsWith("modules/") && name.endsWith(".json"));
  for (const fileName of fileNames) {
    const file = zip.file(fileName);
    if (!file) continue;
    let modulePayload: ModulePayload;
    try {
      modulePayload = JSON.parse(await file.async("string")) as ModulePayload;
    } catch {
      total.errors.push(`${fileName}: 解析失败`);
      continue;
    }
    if (selected && !selected.has(modulePayload.moduleId)) continue;
    for (const sourcePayload of modulePayload.sources) {
      const result = await importSource(sourcePayload, Boolean(options.overwrite), resolver);
      total.added += result.added;
      total.skipped += result.skipped;
      total.overwritten += result.overwritten;
      total.errors.push(...result.errors);
    }
  }

  if (missingMedia.size > 0) {
    total.errors.push(`缺少 ${missingMedia.size} 个媒体对象，部分图片/文件可能丢失`);
  }

  return total;
}

export async function clearModules(moduleIds: DataModuleId[]): Promise<ClearResult> {
  const selected = getSelectedModules(moduleIds);
  const total: ClearResult = { removed: 0, errors: [] };

  for (const dataModule of selected) {
    for (const source of dataModule.sources) {
      const result = await clearSource(source);
      total.removed += result.removed;
      total.errors.push(...result.errors);
    }
  }

  return total;
}
