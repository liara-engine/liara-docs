/**
 * Liara Engine — documentation edge router.
 *
 * Cloudflare serves any matching static asset directly and only invokes this
 * Worker on a "fall-through" (no asset matched). That leaves exactly three
 * jobs, none of which ever runs on the hot path:
 */

/** URL segments that are not module repositories.
 *
 *  `_cas` and `_astro` are the asset stores — the content-addressed one shared
 *  by every module build, and the hub's own bundle. Both are served statically
 *  or not at all; resolving a miss there as if `_astro` were a module would
 *  send a broken script tag on a tour of the redirect table.
 *
 *  `user` is reserved for the section aimed at people who build *with* the
 *  engine rather than on it. It has no repository of its own and probably
 *  never will — the likely shape is a directory inside `liara`, deployed
 *  separately — so the router has to know not to go looking for
 *  `/user/manifest.json` when it sees the segment. */
export const RESERVED_NAMESPACES = new Set(['_cas', '_astro', 'shared-content', 'user']);

/** Sections of a version directory, since the move to a single site. They are
 *  the routes Starlight emits from the preset's content directories — see
 *  `SECTIONS` in docs-shared/astro/index.mjs. */
export const SECTIONS = new Set(['about', 'guides', 'api']);

/** Written beside a retired version's tombstone page. See
 *  docs-shared/tools/make-tombstone.py. */
const REMOVED_MARKER = 'removed.json';

const VERSION_PATTERN = /^(?:dev|latest|pr-\d+|\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

function segmentsOf(pathname) {
    return pathname.split('/').filter(Boolean);
}

function join(parts, trailing) {
    const body = parts.filter(Boolean).join('/');
    return body ? `${body}${trailing}` : '';
}

function redirect(location, status = 302) {
    return { type: 'redirect', status, location };
}

/**
 * Is this version one that was deliberately taken offline?
 *
 * A retired version keeps its address and holds a page saying so, plus a
 * `removed.json` naming its replacement. Every deep link into it — a
 * bookmark, an old answer on a forum — should reach that page rather than
 * the site-wide 404, which would leave the reader unable to tell a retired
 * version from a typo.
 *
 * Answered with the tombstone itself rather than a redirect to it: the
 * status has to stay 410 for the URL that was actually requested, and a
 * redirect to a directory whose index is missing would be a loop.
 */
async function retired(repo, version, lookups) {
    const marker = `/${repo}/${version}/${REMOVED_MARKER}`;
    return await lookups.exists(marker)
        ? { type: 'gone', location: `/${repo}/${version}/` }
        : null;
}

/**
 * Decides what to do with a request that matched no static asset.
 *
 * @param {string} pathname
 * @param {object} lookups
 * @param {(path: string) => Promise<boolean>} lookups.exists  Does an asset exist?
 * @param {(repo: string) => Promise<string|null>} lookups.latestOf  Latest published
 *        version of a module, from its deployed manifest.
 * @returns {Promise<{type: 'redirect'|'notFound', status?: number, location?: string}>}
 */
export async function resolveRoute(pathname, lookups) {
    const segments = segmentsOf(pathname);
    const trailing = pathname.endsWith('/') ? '/' : '';
    if (segments.length === 0) return { type: 'notFound' };

    const [head, ...tail] = segments;

    if (RESERVED_NAMESPACES.has(head)) return { type: 'notFound' };

    // `/<repo>` and `/<repo>/` mean "whatever is current".
    if (tail.length === 0) { return redirect(`/${head}/latest/`); }

    const [rawVersion, ...rest] = tail;

    if (!VERSION_PATTERN.test(rawVersion)) { return redirect(`/${head}/latest/${join(tail, trailing)}`); }

    let version = rawVersion;
    if (version === 'latest') {
        const resolved = await lookups.latestOf(head);
        if (!resolved) return { type: 'notFound' };
        return redirect(`/${head}/${resolved}/${join(rest, trailing)}`);
    }

    if (rest.length === 0) {
        for (const section of ['about', 'guides', 'api']) {
            if (await lookups.exists(`/${head}/${version}/${section}/index.html`)) {
                return redirect(`/${head}/${version}/${section}/`);
            }
        }
        return await retired(head, version, lookups) ?? { type: 'notFound' };
    }

    if (SECTIONS.has(rest[0]) && !pathname.endsWith('/')) {
        if (await lookups.exists(`${pathname}/index.html`)) {
            return redirect(`${pathname}/`, 301);
        }
    }

    return await retired(head, version, lookups) ?? { type: 'notFound' };
}

/* ------------------------------------------------------------ runtime glue */

async function assetExists(env, path) {
    const response = await env.ASSETS.fetch(new Request(`https://assets.invalid${path}`));
    return response.ok;
}

async function readLatest(env, repo) {
    try {
        const response = await env.ASSETS.fetch(new Request(`https://assets.invalid/${repo}/manifest.json`));
        if (!response.ok) return null;
        const manifest = await response.json();
        return manifest?.metadata?.latest ?? null;
    } catch {
        return null;
    }
}

async function goneResponse(env, location) {
    const response = await env.ASSETS.fetch(new Request(`https://assets.invalid${location}`));
    if (!response.ok) return notFoundResponse(env);

    return new Response(response.body, {
        status: 410,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}

async function notFoundResponse(env) {
    const response = await env.ASSETS.fetch(new Request('https://assets.invalid/404.html'));
    if (response.ok) {
        return new Response(response.body, {
            status: 404,
            headers: { 'content-type': 'text/html; charset=utf-8' },
        });
    }
    return new Response('Not found', { status: 404 });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        const route = await resolveRoute(url.pathname, {
            exists: (path) => assetExists(env, path),
            latestOf: (repo) => readLatest(env, repo),
        });

        if (route.type === 'redirect') {
            const location = new URL(route.location, url.origin);
            location.search = url.search;
            return Response.redirect(location.toString(), route.status);
        }

        if (route.type === 'gone') {
            return goneResponse(env, route.location);
        }

        return notFoundResponse(env);
    },
};
