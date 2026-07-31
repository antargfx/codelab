// Lite Tube service worker — caches only the static app shell.
// Video data/thumbnails/playback always go to the network (never cached),
// so content stays fresh and storage stays tiny.
var CACHE_NAME = "litetube-shell-v1";
var SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(SHELL_FILES).catch(function(){ /* ignore missing optional files */ });
    })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return;

  var url = new URL(req.url);

  // Never cache API calls, thumbnails, or the YouTube player itself.
  if(url.origin !== self.location.origin){
    return; // let the network handle it
  }

  // App shell: cache-first, falling back to network.
  event.respondWith(
    caches.match(req).then(function(cached){
      if(cached) return cached;
      return fetch(req).then(function(res){
        if(res && res.ok){
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        }
        return res;
      }).catch(function(){
        return cached;
      });
    })
  );
});
