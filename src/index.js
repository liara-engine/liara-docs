/**
 * Liara Engine — documentation edge router.
 *
 * Cloudflare serves any matching static asset directly and only invokes this
 * Worker on a "fall-through" (no asset matched). That leaves exactly three
 * jobs, none of which ever runs on the hot path:
 *
 *   1. /<repo>/latest/...      -> redirect to the module's latest version,
 *                                 read from /<repo>/manifest.json (metadata.latest).
 *      /<repo>  or  /<repo>/   -> same, as a convenience entry point.
 *   2. /<repo>/<version>/      -> redirect to book/ if it exists, else doxygen/.
 *   3. anything else           -> serve /404.html with a 404 status.
 */

const VIEWS = ["book", "doxygen"];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const segments = url.pathname.split("/").filter(Boolean);

        if (segments.length === 0) {
            return notFound(env, url);
        }

        const [repo, rawVersion, ...rest] = segments;

        let version = rawVersion;
        let substituted = false;
        if (rawVersion === undefined || rawVersion === "latest") {
            version = await resolveLatest(env, url, repo);
            substituted = true;
            if (!version) return notFound(env, url);
        }

        if (substituted && rest.length > 0) {
            const tail = url.pathname.endsWith("/") ? "/" : "";
            const target = "/" + [repo, version, ...rest].join("/") + tail + url.search;
            return redirect(target, 302, "no-cache");
        }

        if (rest.length === 0) {
            const view = await firstExistingView(env, url, repo, version);
            if (!view) return notFound(env, url);
            const target = `/${repo}/${version}/${view}/` + url.search;
            return redirect(target, 302, substituted ? "no-cache" : "public, max-age=3600");
        }

        return notFound(env, url);
    },
};

async function resolveLatest(env, url, repo) {
    const res = await env.ASSETS.fetch(new URL(`/${repo}/manifest.json`, url.origin));
    if (res.status !== 200) return null;
    try {
        const latest = (await res.json())?.metadata?.latest;
        return typeof latest === "string" && latest.length > 0 ? latest : null;
    } catch {
        return null;
    }
}

async function firstExistingView(env, url, repo, version) {
    for (const view of VIEWS) {
        const probe = new URL(`/${repo}/${version}/${view}/index.html`, url.origin);
        const res = await env.ASSETS.fetch(probe);
        if (res.status === 200) return view;
    }
    return null;
}

function redirect(location, status, cacheControl) {
    return new Response(null, {
        status,
        headers: { Location: location, "Cache-Control": cacheControl },
    });
}

async function notFound(env, url) {
    const res = await env.ASSETS.fetch(new URL("/404.html", url.origin));
    return new Response(res.body, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}