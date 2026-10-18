/**
 * 左下角固定迷你播放器
 * 歌单仍由 Meting 接口提供，但音频直链改为网易云外链：
 * https://music.163.com/song/media/outer/url?id=<songid>.mp3
 * 原因：Meting 的 type=url 直链经常 404 / 超时，APlayer 遇到错误会在 2 秒后自动跳过。
 */
(function () {
  "use strict";

  var PLAYLIST_ID = "2331639478";
  var APIS = [
    "https://api.i-meto.com/meting/api",
    "https://meting.qjqq.cn/api",
    "https://api.injahow.cn/meting/api"
  ];
  var OUTER_URL = "https://music.163.com/song/media/outer/url?id=";
  var FALLBACK_COVER = "/img/HG.JPG";
  var CACHE_KEY = "cookiesky.navmusic.playlist.v1";
  var CACHE_TTL = 6 * 60 * 60 * 1000;
  var FETCH_TIMEOUT = 10000;
  var CONTAINER_ID = "nav-music";

  function pickId(item) {
    var id = item.songid || item.id || "";
    if (!id) {
      var matched = String(item.url || "").match(/[?&]id=(\d+)/);
      if (matched) id = matched[1];
    }
    return id ? String(id) : "";
  }

  function toTrack(item) {
    var id = pickId(item);
    if (!id) return null;
    return {
      name: item.title || item.name || "未知歌曲",
      artist: item.author || item.artist || "未知歌手",
      // 主用网易云外链，稳定且不依赖第三方接口
      url: OUTER_URL + encodeURIComponent(id) + ".mp3",
      // 外链失效时用接口直链兜底
      fallback: item.url || "",
      cover: item.pic || item.cover || FALLBACK_COVER,
      lrc: item.lrc || "",
      type: "auto"
    };
  }

  function normalize(data) {
    if (!Array.isArray(data)) return [];
    return data.map(toTrack).filter(function (track) {
      return track && track.url;
    });
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tracks) || !data.tracks.length) return null;
      return {
        tracks: data.tracks,
        fresh: Date.now() - (data.at || 0) < CACHE_TTL
      };
    } catch (err) {
      return null;
    }
  }

  function saveCache(tracks) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        tracks: tracks,
        at: Date.now()
      }));
    } catch (err) {}
  }

  function fetchJson(url) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error("timeout"));
      }, FETCH_TIMEOUT);

      fetch(url, {
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          clearTimeout(timer);
          resolve(data);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function fetchPlaylist() {
    // 多镜像同时请求，谁先返回可用歌单就用谁
    var attempts = APIS.map(function (api) {
      return fetchJson(api + "?server=netease&type=playlist&id=" +
        encodeURIComponent(PLAYLIST_ID) + "&r=" + Date.now());
    });

    return new Promise(function (resolve, reject) {
      var pending = attempts.length;
      var lastError = null;
      if (!pending) {
        reject(new Error("no api"));
        return;
      }
      attempts.forEach(function (attempt) {
        attempt.then(function (data) {
          var tracks = normalize(data);
          if (!tracks.length) throw new Error("empty playlist");
          resolve(tracks);
        }).catch(function (err) {
          lastError = err;
          pending -= 1;
          if (pending === 0) reject(lastError || new Error("playlist failed"));
        });
      });
    });
  }

  function whenAPlayerReady(callback) {
    if (typeof window.APlayer !== "undefined") {
      callback();
      return;
    }
    var tries = 0;
    var timer = setInterval(function () {
      if (typeof window.APlayer !== "undefined") {
        clearInterval(timer);
        callback();
      } else if (++tries > 80) {
        clearInterval(timer);
      }
    }, 250);
  }

  function bindFallback(player) {
    // APlayer 默认在音频报错 2 秒后跳过。这里先尝试用接口直链补救，
    // 补救期间拦截一次 skipForward，避免刚切到兜底链接就被跳过。
    var originalSkip = player.skipForward;

    player.skipForward = function () {
      if (player.__navRetrying) {
        player.__navRetrying = false;
        return;
      }
      return originalSkip.apply(player, arguments);
    };

    player.on("listswitch", function () {
      player.__navRetried = false;
      player.__navRetrying = false;
    });

    player.on("error", function () {
      var audios = player.list && player.list.audios;
      var track = audios && audios[player.list.index];
      if (!track || !track.fallback || player.__navRetried) return;
      if (track.url === track.fallback) return;

      player.__navRetried = true;
      player.__navRetrying = true;
      player.audio.src = track.fallback;
      player.audio.load();
      var played = player.audio.play();
      if (played && played.catch) played.catch(function () {});
    });
  }

  function build(tracks) {
    if (window.__navMusicPlayer) return;
    var container = document.getElementById(CONTAINER_ID);
    if (!container || typeof window.APlayer === "undefined" || !tracks.length) return;

    var player = new window.APlayer({
      container: container,
      audio: tracks,
      fixed: true,
      mini: true,
      autoplay: false,
      mutex: true,
      lrcType: 1,
      listFolded: false,
      preload: "none",
      order: "random",
      theme: "#2980b9",
      storageName: "cookiesky-nav-music"
    });

    window.__navMusicPlayer = player;
    window.aplayers = window.aplayers || [];
    window.aplayers.push(player);
    bindFallback(player);
  }

  function start() {
    if (!document.getElementById(CONTAINER_ID)) return;

    var cached = readCache();
    if (cached && cached.fresh) {
      whenAPlayerReady(function () {
        build(cached.tracks);
      });
      return;
    }

    whenAPlayerReady(function () {
      fetchPlaylist()
        .then(function (tracks) {
          saveCache(tracks);
          build(tracks);
        })
        .catch(function () {
          if (cached && cached.tracks.length) build(cached.tracks);
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, false);
  } else {
    start();
  }
})();
