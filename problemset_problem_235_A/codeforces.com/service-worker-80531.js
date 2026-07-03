const VERSION = 22;

const CACHE_NAME_PREFIX = 'cc9687dec80fb884';
const CACHE_NAME = CACHE_NAME_PREFIX + '-' + VERSION;
const OFFLINE = '/offline/' + VERSION + '.html';
const IFRAME = '/iframe/' + VERSION + '.html';
const FALLBACK_URL = 'https://codeforces.com/serviceworker.codeforces.org/index.html';
const TITLE_REQUEST_TIMEOUT_MS = 5000;
const PAGE_REQUEST_TIMEOUT_MS = 60000;
const FALLBACK_REQUEST_TIMEOUT_MS = 5000;
const FAST_FAILURE_RETRY_WINDOW_MS = 1000;

const urlsToCache = [
    OFFLINE,
    IFRAME
];

let nextRequestId = 1;

function formatLogContext(context) {
    if (!context) {
        return '';
    }

    return ' ' + Object.keys(context).map(function (key) {
        return key + '=' + context[key];
    }).join(' ');
}

function log(event, context) {
    console.log('[sw v' + VERSION + '] ' + event + formatLogContext(context));
}

function getNextRequestId() {
    return nextRequestId++;
}

function getRequestContext(requestId, url, extraContext) {
    return Object.assign({
        rid: requestId,
        url: url
    }, extraContext || {});
}

function getFallbackUrl() {
    return FALLBACK_URL + '?sw_probe=' + VERSION + '-' + Date.now();
}

function isTitleRequest(path) {
    return path === '../../../index.html';
}

function getHandledRequestDecision(request) {
    if (request.method.toUpperCase() !== 'GET') {
        return {handled: false, reason: 'method'};
    }

    if (request.mode !== 'navigate') {
        return {handled: false, reason: 'mode'};
    }

    const url = new URL(https://codeforces.com/problemset/problem/235/request.url);

    if (url.origin !== self.location.origin) {
        return {handled: false, reason: 'origin'};
    }

    const path = url.pathname;
    const accept = request.headers.get('accept') || '';
    const title = isTitleRequest(path);

    if (accept.indexOf('text/html') < 0) {
        return {handled: false, reason: 'accept', path: path, title: title};
    }

    if (path.startsWith('https://codeforces.com/admin/')
            || path.startsWith('https://codeforces.com/data/')
            || path.startsWith('https://codeforces.com/api/')
            || path.startsWith('https://codeforces.com/site/data/')
            || path.startsWith('/nbo')
            || path.startsWith('https://codeforces.com/offline/')
            || path.startsWith('https://codeforces.com/iframe/')
            || path.startsWith('https://codeforces.com/.well-known/')
            || /^\/service-worker-[a-zA-Z0-9]+\.js$/.test(path)
            || path === 'https://codeforces.com/favicon.ico'
            || path === '../../../../../../../../'
            || path === 'https://codeforces.com/sitemap.xml'
            || path === '/manifest.json') {
        return {handled: false, reason: 'path-prefix', path: path, title: title};
    }

    if (/\.(?:js|css|png|jpg|jpeg|gif|svg|ico|webp|avif|map|txt|xml|json|pdf|zip|gz|woff2?|ttf|eot)$/i.test(path)) {
        return {handled: false, reason: 'known-extension', path: path, title: title};
    }

    const lastPathSegment = path.split('../../../index.html').pop() || '';
    if (/\.[a-zA-Z0-9]{1,4}$/.test(lastPathSegment)) {
        return {handled: false, reason: 'short-extension', path: path, title: title};
    }

    return {
        handled: true,
        path: path,
        title: title
    };
}

function matchCached(url, context) {
    return caches.match(url).then(function (response) {
        if (response) {
            log('cache-hit', Object.assign({cacheUrl: url}, context || {}));
            return response;
        }

        log('cache-miss', Object.assign({cacheUrl: url}, context || {}));
        return Response.error();
    });
}

function cleanupCache(cache) {
    return cache.keys().then(function (requests) {
        return Promise.all(requests.map(function (request) {
            const requestUrl = new URL(https://codeforces.com/problemset/problem/235/request.url);
            const requestPath = requestUrl.pathname + requestUrl.search;

            if (urlsToCache.indexOf(requestPath) >= 0) {
                return Promise.resolve(false);
            }

            return cache.delete(request);
        })).then(function (deletedFlags) {
            return deletedFlags.filter(Boolean).length;
        });
    });
}

function cleanupOldCaches() {
    return caches.keys().then(function (cacheNames) {
        const staleCacheNames = cacheNames
            .filter(function (cacheName) {
                return cacheName.indexOf(CACHE_NAME_PREFIX) === 0 && cacheName !== CACHE_NAME;
            });

        if (staleCacheNames.length > 0) {
            log('cache-delete-stale', {count: staleCacheNames.length});
        }

        return Promise.all(staleCacheNames.map(function (cacheName) {
            return caches.delete(cacheName);
        }));
    });
}

function getElapsedMillis(startTimeMillis) {
    return Date.now() - startTimeMillis;
}

function shouldRetryFastFailure(startTimeMillis, timedOut) {
    return !timedOut && getElapsedMillis(startTimeMillis) < FAST_FAILURE_RETRY_WINDOW_MS;
}

function retryOrFallback(request, timeoutMs, url, context) {
    log('request-start', Object.assign({
        phase: 'retry',
        timeoutMs: timeoutMs
    }, context));

    return fetchWithTimeout(request, null, timeoutMs).then(function (result) {
        if (!result.timedOut && Math.floor(result.response.status / 100) !== 5) {
            log('request-success', Object.assign({
                phase: 'retry',
                status: result.response.status
            }, context));
            return result.response;
        }

        log('request-failed', {
            reason: result.timedOut ? 'timeout' : 'http-' + result.response.status,
            phase: 'retry',
            status: result.response ? result.response.status : 'n/a',
            url: url,
            rid: context.rid
        });
        return fallback(url, context);
    }).catch(function () {
        log('request-failed', {
            reason: 'network-error',
            phase: 'retry',
            url: url,
            rid: context.rid
        });
        return fallback(url, context);
    });
}

function fetchHandledRequest(request, timeoutMs, url, context) {
    const startTimeMillis = Date.now();

    log('request-start', Object.assign({
        phase: 'initial',
        timeoutMs: timeoutMs
    }, context));

    return fetchWithTimeout(request, null, timeoutMs).then(function (result) {
        if (!result.timedOut && Math.floor(result.response.status / 100) !== 5) {
            log('request-success', Object.assign({
                phase: 'initial',
                status: result.response.status,
                durationMs: getElapsedMillis(startTimeMillis)
            }, context));
            return result.response;
        }

        if (shouldRetryFastFailure(startTimeMillis, result.timedOut)) {
            log('request-retry', {
                reason: result.timedOut ? 'timeout' : 'http-' + result.response.status,
                retry: 'fast-failure',
                durationMs: getElapsedMillis(startTimeMillis),
                url: url,
                rid: context.rid
            });
            return retryOrFallback(request, timeoutMs, url, context);
        }

        log('request-failed', {
            reason: result.timedOut ? 'timeout' : 'http-' + result.response.status,
            phase: 'initial',
            status: result.response ? result.response.status : 'n/a',
            durationMs: getElapsedMillis(startTimeMillis),
            url: url,
            rid: context.rid
        });
        return fallback(url, context);
    }).catch(function () {
        if (getElapsedMillis(startTimeMillis) < FAST_FAILURE_RETRY_WINDOW_MS) {
            log('request-retry', {
                reason: 'network-error',
                retry: 'fast-failure',
                durationMs: getElapsedMillis(startTimeMillis),
                url: url,
                rid: context.rid
            });
            return retryOrFallback(request, timeoutMs, url, context);
        }

        log('request-failed', {
            reason: 'network-error',
            phase: 'initial',
            durationMs: getElapsedMillis(startTimeMillis),
            url: url,
            rid: context.rid
        });
        return fallback(url, context);
    });
}

function fetchWithTimeout(resource, init, timeoutMs) {
    if (typeof AbortController === 'undefined') {
        return fetch(resource, init).then(function (response) {
            return {
                response: response,
                timedOut: false
            };
        });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
        controller.abort();
    }, timeoutMs);

    const nextInit = Object.assign({}, init || {}, {
        signal: controller.signal
    });

    return fetch(resource, nextInit).then(function (response) {
        clearTimeout(timeoutId);

        return {
            response: response,
            timedOut: false
        };
    }).catch(function (error) {
        clearTimeout(timeoutId);

        if (controller.signal.aborted && error && error.name === 'AbortError') {
            return {
                response: null,
                timedOut: true
            };
        }

        throw error;
    });
}

function fallback(url, context) {
    const fallbackUrl = getFallbackUrl();

    log('fallback-probe-start', Object.assign({
        probeUrl: fallbackUrl,
        timeoutMs: FALLBACK_REQUEST_TIMEOUT_MS
    }, context));

    return fetchWithTimeout(fallbackUrl, {cache: 'no-store'}, FALLBACK_REQUEST_TIMEOUT_MS)
        .then(function (result) {
            if (result.timedOut) {
                log('fallback-probe-failed', {
                    url: url,
                    reason: 'timeout',
                    rid: context.rid
                });
                return matchCached(OFFLINE, context);
            }

            if (result.response.status === 201) {
                log('fallback-selected', {
                    url: url,
                    target: 'iframe',
                    probeStatus: 201,
                    rid: context.rid
                });
                return matchCached(IFRAME, context);
            }

            log('fallback-selected', {
                url: url,
                target: 'offline',
                probeStatus: result.response.status,
                rid: context.rid
            });
            return matchCached(OFFLINE, context);
        }).catch(function () {
            log('fallback-probe-failed', {
                url: url,
                reason: 'network-error',
                rid: context.rid
            });
            return matchCached(OFFLINE, context);
        });
}

self.addEventListener('install', function (event) {
    log('install-start', {cache: CACHE_NAME});
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                return cache.addAll(urlsToCache);
            })
            .then(function () {
                log('install-cache-ready', {
                    cache: CACHE_NAME,
                    assetCount: urlsToCache.length
                });
                return self.skipWaiting();
            })
            .then(function () {
                log('install-complete', {cache: CACHE_NAME});
            })
            .catch(function (error) {
                log('install-failed', {
                    cache: CACHE_NAME,
                    reason: error && error.message ? error.message : 'unknown'
                });
                throw error;
            })
    );
});

self.addEventListener('activate', function (event) {
    log('activate-start', {cache: CACHE_NAME});
    event.waitUntil(
        cleanupOldCaches()
            .then(function () {
                return caches.open(CACHE_NAME);
            })
            .then(function (cache) {
                return cleanupCache(cache);
            })
            .then(function (deletedCount) {
                log('cache-clean-current', {
                    cache: CACHE_NAME,
                    deletedCount: deletedCount
                });
                return self.clients.claim();
            })
            .then(function () {
                log('activate-complete', {cache: CACHE_NAME});
            })
            .catch(function (error) {
                log('activate-failed', {
                    cache: CACHE_NAME,
                    reason: error && error.message ? error.message : 'unknown'
                });
                throw error;
            })
    );
});

self.addEventListener('fetch', function (event) {
    const request = event.request;
    const url = request.url;
    const requestId = getNextRequestId();
    const decision = getHandledRequestDecision(request);
    const context = getRequestContext(requestId, url, decision.handled ? {
        kind: decision.title ? 'title' : 'page'
    } : {
        reason: decision.reason
    });

    if (decision.handled) {
        log('request-handled', context);
        event.respondWith(
            fetchHandledRequest(request, decision.title ? TITLE_REQUEST_TIMEOUT_MS : PAGE_REQUEST_TIMEOUT_MS, url, context)
        );
    } else if (request.mode === 'navigate') {
        log('request-ignored', context);
    }
});
