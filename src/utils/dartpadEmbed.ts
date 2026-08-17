/**
 * Real DartPad embed via GitHub gists.
 *
 * WHY THIS EXISTS
 * ---------------
 * Google deprecated DartPad's old `embed-*.html?sourceCode=...` + postMessage
 * source-injection (the wiki "Embedding guide", Jan 2024, says the form is "no
 * longer supported"; verified empirically: `embed-flutter.html?sourceCode=...`
 * redirects to `/?embed=true&sourceCode=...` and still loads the DEFAULT Dart
 * sample, ignoring the supplied source). The ONLY public, free way to show
 * custom Dart in an embedded DartPad is via a GitHub gist id:
 *
 *   https://dartpad.dev/embed-flutter.html?id=<gistId>&run=true
 *
 * So, when the user has provided a GitHub gist token (Settings → Gist Token),
 * we POST the AI-generated Dart to `api.github.com/gists`, grab the returned
 * id, and point the iframe at that URL. The iframe then runs the REAL Flutter
 * canvas — exactly what the user asked for. Without a token we cannot create
 * a gist, so callers should fall back to the structural preview and surface a
 * "add a gist token to enable live DartPad" hint.
 *
 * Gists are created as public anonymous snippets (no description, single
 * `main.dart` file). They are cheap and disposable; we cache the resulting
 * embed URL by a hash of the source so we don't re-create on every keystroke.
 */

const GITHUB_GIST_API = 'https://api.github.com/gists';
const DARTPAD_EMBED_BASE = 'https://dartpad.dev/embed-flutter.html';

export interface DartpadEmbedResult {
  url: string;
  gistId: string;
  /** Best-effort; may be '' if GitHub didn't return it. */
  htmlUrl: string;
}

const urlBySource = new Map<string, DartpadEmbedResult>();
const inflight = new Map<string, Promise<DartpadEmbedResult>>();
const URL_CACHE_MAX = 32;

function hashSource(source: string): string {
  // FNV-1a 32-bit; good enough as a cache key, no crypto needed.
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Create (or reuse a cached) gist for the given Dart source and return a
 * DartPad embed URL that runs it. Requires a GitHub token with the `gist`
 * scope. Throws if the token is missing or the request fails — the caller is
 * expected to catch and fall back to the structural preview.
 */
export async function buildDartpadEmbedUrl(
  source: string,
  token: string,
  opts?: { run?: boolean; dark?: boolean }
): Promise<DartpadEmbedResult> {
  if (!token) throw new Error('No GitHub gist token configured');
  if (!source.trim()) throw new Error('No Dart source to embed');

  const key = hashSource(source);
  const cached = urlBySource.get(key);
  if (cached) return cached;

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(GITHUB_GIST_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: 'SAW AI live preview',
          public: true,
          files: { 'main.dart': { content: source } },
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`GitHub gist creation failed (${res.status}): ${detail}`);
      }
      const data = await res.json();
      const gistId = data?.id;
      if (!gistId) throw new Error('GitHub gist creation returned no id');
      const params = new URLSearchParams({
        id: String(gistId),
        run: opts?.run === false ? 'false' : 'true',
        theme: opts?.dark ? 'dark' : 'light',
        split: '0',
      });
      const result: DartpadEmbedResult = {
        url: `${DARTPAD_EMBED_BASE}?${params.toString()}`,
        gistId: String(gistId),
        htmlUrl: data?.html_url || '',
      };
      if (urlBySource.size >= URL_CACHE_MAX) {
        const firstKey = urlBySource.keys().next().value;
        if (firstKey !== undefined) urlBySource.delete(firstKey);
      }
      urlBySource.set(key, result);
      return result;
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  }
  return pending;
}

/** Quick deep-link to DartPad's main editor (no source prefill — the old
 *  sourceCode param is ignored). Used as an escape hatch when no gist token. */
export function dartpadEditorUrl(): string {
  return 'https://dartpad.dev/';
}
