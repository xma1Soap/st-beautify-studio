// Before / after of a piece of text, for showing what the AI changed.

export interface DiffRow {
  t: ' ' | '+' | '-';
  s: string;
}

/** Lines, with very long ones (HTML squeezed onto one line) cut after each tag and CSS rule, so changes stand out. */
function pieces(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length <= 160) out.push(line);
    else out.push(...line.split(/(?<=>)(?=<)|(?<=[;}])(?=\S)/));
  }
  return out;
}

/** Rows of a diff: shared rows, removed ones (-), added ones (+). */
export function textDiff(a: string, b: string): DiffRow[] {
  const A = pieces(a);
  const B = pieces(b);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf);
  const b2 = B.slice(pre, B.length - suf);
  const out: DiffRow[] = A.slice(0, pre).map((s) => ({ t: ' ', s }));
  const n = a2.length;
  const m = b2.length;
  if (n * m > 4_000_000) {
    out.push(...a2.map((s) => ({ t: '-' as const, s })), ...b2.map((s) => ({ t: '+' as const, s })));
  } else {
    // longest common subsequence, then walk it
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i * w + j] = a2[i] === b2[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) {
        out.push({ t: ' ', s: a2[i] });
        i++;
        j++;
      } else if (i < n && (j >= m || L[(i + 1) * w + j] >= L[i * w + j + 1])) out.push({ t: '-', s: a2[i++] });
      else out.push({ t: '+', s: b2[j++] });
    }
  }
  out.push(...A.slice(A.length - suf).map((s) => ({ t: ' ' as const, s })));
  return out;
}

/** Only the changed rows with a little around them; long unchanged stretches become one "…" row (t ' ', s null). */
export function hunks(rows: DiffRow[], around = 2): (DiffRow | { t: 'gap'; n: number })[] {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.t === ' ') return;
    for (let k = Math.max(0, i - around); k <= Math.min(rows.length - 1, i + around); k++) keep[k] = true;
  });
  const out: (DiffRow | { t: 'gap'; n: number })[] = [];
  let gap = 0;
  rows.forEach((r, i) => {
    if (keep[i]) {
      if (gap) out.push({ t: 'gap', n: gap });
      gap = 0;
      out.push(r);
    } else gap++;
  });
  if (gap && out.length) out.push({ t: 'gap', n: gap });
  return out;
}

export const diffCount = (rows: DiffRow[]) => ({ add: rows.filter((r) => r.t === '+').length, del: rows.filter((r) => r.t === '-').length });
