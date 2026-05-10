// SoSoFlows service worker - offline cache for shell, network-first for API
var CACHE_VERSION = "sosoflows-v1";
var SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json"
];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return cache.addAll(SHELL_ASSETS).catch(function(){});
    }).then(function(){ self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_VERSION; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  // API calls + AI brief: network-first with cache fallback (server already caches 7d/6h)
  if (url.pathname.indexOf("/api.php") >= 0 || url.pathname.indexOf("/ai.php") >= 0) {
    e.respondWith(
      fetch(e.request).then(function(resp){
        var clone = resp.clone();
        caches.open(CACHE_VERSION).then(function(c){ c.put(e.request, clone).catch(function(){}); });
        return resp;
      }).catch(function(){
        return caches.match(e.request);
      })
    );
    return;
  }
  // Shell + fonts: cache-first
  if (e.request.method === "GET") {
    e.respondWith(
      caches.match(e.request).then(function(cached){
        return cached || fetch(e.request).then(function(resp){
          if (resp && resp.status === 200 && (url.origin === self.location.origin || url.host.indexOf("fonts.") >= 0)) {
            var clone = resp.clone();
            caches.open(CACHE_VERSION).then(function(c){ c.put(e.request, clone).catch(function(){}); });
          }
          return resp;
        });
      }).catch(function(){
        return new Response("offline", { status: 503 });
      })
    );
  }
});
