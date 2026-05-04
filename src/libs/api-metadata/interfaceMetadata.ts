/**
 * Project `api-metadata.js` 내 `interfaces` 항목에서 tranId·desc 추출.
 * `key: { tranId: '...', desc: '...' [, 추가필드] }` 형태를 가정.
 */

export type ApiMetadataEntry = { key: string; tranId: string; desc: string };

/** proxy·Metadata 간 tranId 비교용 (공백·NBSP 정리 후 대문자 통일) */
export function normalizeTranIdKey(s: string): string {
  return s
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function unescapeJsString(s: string): string {
  return s.replace(/\\([\s\S])/g, (_, ch: string) => ch);
}

/**
 * 소스 전체를 스캔해 interfaces 엔트리 목록 반환 (파일 내 등장 순서).
 */
export function parseApiMetadataEntries(source: string): ApiMetadataEntry[] {
  const out: ApiMetadataEntry[] = [];
  const re =
    /(\b[a-zA-Z_$][\w$]*)\s*:\s*\{\s*tranId\s*:\s*(['"])((?:\\.|(?!\2).)*?)\2\s*,\s*desc\s*:\s*(['"])((?:\\.|(?!\4).)*?)\4/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({
      key: m[1],
      tranId: unescapeJsString(m[3]),
      desc: unescapeJsString(m[5]),
    });
  }
  return out;
}

/**
 * 동일 tranId(정규화 기준)가 여러 key에 있으면 파일에서 먼저 나온 항목만 사용.
 * 조회는 원문·정규화 키 모두 등록해 대소문자·공백 차이를 흡수.
 */
export function buildTransactionMetadataLookup(entries: ApiMetadataEntry[]): Map<string, ApiMetadataEntry> {
  const logicalFirst = new Map<string, ApiMetadataEntry>();
  for (const e of entries) {
    const n = normalizeTranIdKey(e.tranId);
    if (!n) continue;
    if (!logicalFirst.has(n)) logicalFirst.set(n, e);
  }
  const lookup = new Map<string, ApiMetadataEntry>();
  for (const e of logicalFirst.values()) {
    const raw = e.tranId.trim();
    const norm = normalizeTranIdKey(e.tranId);
    for (const k of new Set([raw, norm].filter((x) => x.length > 0))) {
      if (!lookup.has(k)) lookup.set(k, e);
    }
  }
  return lookup;
}

/** proxy 행의 트랜(`tran`) 또는 API이름(`name`)이 sample-project `tranId`와 맞으면 해당 API metadata 항목 반환 */
export function findMetadataForApi(
  lookup: Map<string, ApiMetadataEntry>,
  row: { tran: string; name: string },
): ApiMetadataEntry | undefined {
  for (const candidate of [row.tran, row.name]) {
    const v = candidate.trim();
    if (!v) continue;
    const sample-project = lookup.get(v) ?? lookup.get(normalizeTranIdKey(v));
    if (sample-project) return sample-project;
  }
  return undefined;
}
