(function () {
  "use strict";

  var DEFAULT_NETEASE_ID = "2331639478";
  var DEFAULT_SOURCE = {
    kind: "snapshot",
    url: "assets/default-playlist.json",
    name: "默认歌单"
  };
  var APIS = [
    "https://api.i-meto.com/meting/api",
    "https://meting.qjqq.cn/api",
    "https://api.injahow.cn/meting/api"
  ];
  var API = APIS[0];
  var activeApi = APIS[0];
  var FALLBACK_COVER = "assets/cover.webp";
  var LS_SOURCE = "cookiesky.player.source";
  var LS_CACHE = "cookiesky.player.cache";
  var LS_VOLUME = "cookiesky.player.volume";
  var LS_SHUFFLE = "cookiesky.player.shuffle";
  var LS_REPEAT = "cookiesky.player.repeat";
  var LS_DOWNLOAD_URLS = "cookiesky.player.downloadUrls.v1";
  var DOWNLOAD_URL_TTL = 12 * 60 * 60 * 1000;
  var FETCH_TIMEOUT = 9000;
  var SONG_TIMEOUT = 25000;

  var state = {
    playlist: [],
    source: null,
    index: 0,
    shuffle: false,
    repeat: "all",
    volume: 0.8,
    pendingTracks: [],
    hasLocal: false,
    search: "",
    trackLoaded: false,
    retried: false,
    skipCount: 0,
    downloading: false,
    downloadCancel: false
  };

  var audio = new Audio();
  audio.preload = "metadata";
  var downloadController = null;
  var downloadUrlCache = {};

  var els = {};
  var toastTimer = null;
  var playWatch = null;

  function armPlayWatch() {
    clearTimeout(playWatch);
    playWatch = setTimeout(function () {
      if (audio.paused) return;
      if (audio.currentTime > 0.3 || audio.readyState >= 3) return;
      updatePlayState(false);
      recoverTrack();
    }, 8000);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function fetchJson(url, timeout) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, timeout || FETCH_TIMEOUT);
    return fetch(url, { cache: "no-store", signal: controller ? controller.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  function fetchJsonRetry(url, timeout) {
    return fetchJson(url, timeout).catch(function () {
      return sleep(350).then(function () {
        return fetchJson(url, timeout);
      });
    });
  }

  function sourceKey(source) {
    if (!source) return "";
    return source.kind + ":" + (source.id || source.url || source.name || "");
  }

  function saveCache(source, tracks) {
    if (!source || !tracks || !tracks.length) return;
    if (source.kind === "files") return;
    try {
      localStorage.setItem(LS_CACHE, JSON.stringify({
        source: { kind: source.kind, id: source.id || "", url: source.url || "", name: source.name || "" },
        tracks: tracks.slice(0, 500),
        at: Date.now()
      }));
    } catch (err) {}
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(LS_CACHE);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.source || !Array.isArray(data.tracks) || !data.tracks.length) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function restoreDownloadUrls() {
    try {
      var data = JSON.parse(localStorage.getItem(LS_DOWNLOAD_URLS) || "null");
      if (!data || !data.urls || Date.now() - (data.at || 0) > DOWNLOAD_URL_TTL) return;
      Object.keys(data.urls).forEach(function (id) {
        var url = data.urls[id];
        if (isHttpUrl(url)) downloadUrlCache[id] = url;
      });
    } catch (err) {}
  }

  function saveDownloadUrls() {
    try {
      localStorage.setItem(LS_DOWNLOAD_URLS, JSON.stringify({
        at: Date.now(),
        urls: downloadUrlCache
      }));
    } catch (err) {}
  }

  function cacheEls() {
    [
      "bg", "cover", "title", "artist", "currentTime", "duration", "progress",
      "shuffleBtn", "prevBtn", "playBtn", "playIcon", "nextBtn", "repeatBtn",
      "repeatIcon", "muteBtn", "volumeIcon", "volume", "sourceChip", "playlistName",
      "trackCount", "sourceLabel", "queueBadge", "trackList", "queueEmpty",
      "search", "importBtn", "localFileBtn", "importModal", "closeModal",
      "importInput", "importConfirm", "useDefault", "fileInput", "toast",
      "addModeModal", "addCount", "addAppend", "addReplace", "closeAddMode",
      "downloadAllBtn", "downloadAllText", "downloadCurrentBtn"
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  function formatTime(value) {
    if (!isFinite(value) || value < 0) return "00:00";
    var total = Math.floor(value);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setRange(el, percent) {
    if (!el) return;
    el.style.setProperty("--p", clamp(percent, 0, 100) + "%");
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2800);
  }

  function normalizeTracks(list) {
    return (Array.isArray(list) ? list : [])
      .filter(function (item) {
        return item && (item.url || item.id || item.songid);
      })
      .map(function (item) {
        var url = item.url ? String(item.url) : "";
        if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
        var idMatch = url.match(/[?&]id=(\d+)/);
        return {
          name: item.title || item.name || "未知歌曲",
          artist: item.author || item.artist || "未知歌手",
          url: url,
          cover: item.pic || item.cover || FALLBACK_COVER,
          id: item.songid || item.id || (idMatch ? idMatch[1] : "")
        };
      });
  }

  function buildApiUrl(source, api) {
    if (source.kind === "netease") {
      return (api || activeApi) + "?server=netease&type=playlist&id=" + encodeURIComponent(source.id) + "&r=" + Date.now();
    }
    return source.url;
  }

  function fetchPlaylistWithMirrors(source) {
    if (source.kind !== "netease") {
      return fetchJson(source.url).then(readTrackArray);
    }

    // 多个接口同时请求，谁先成功用谁的，避免一个接口卡住整页
    var attempts = APIS.map(function (api) {
      return fetchJson(buildApiUrl(source, api)).then(function (data) {
        var tracks = readTrackArray(data);
        activeApi = api;
        return tracks;
      });
    });

    return firstSuccess(attempts);
  }

  function firstSuccess(promises) {
    return new Promise(function (resolve, reject) {
      var pending = promises.length;
      var lastError = null;
      if (!pending) {
        reject(new Error("没有可用的歌单接口"));
        return;
      }
      promises.forEach(function (promise) {
        promise.then(resolve).catch(function (err) {
          lastError = err;
          pending -= 1;
          if (pending === 0) {
            reject(lastError || new Error("歌单加载失败"));
          }
        });
      });
    });
  }

  function readTrackArray(data) {
    if (!Array.isArray(data)) throw new Error("歌单格式不正确");
    var tracks = normalizeTracks(data);
    if (!tracks.length) throw new Error("歌单里没有可播放的歌曲");
    return tracks;
  }

  function fetchTracks(source) {
    if (source.kind === "files") {
      return Promise.resolve(normalizeTracks(source.tracks));
    }
    return fetchPlaylistWithMirrors(source, 0);
  }

  function sourceLabel(source) {
    if (source.kind === "netease") return "网易云";
    if (source.kind === "snapshot") return "网易云";
    if (source.kind === "files") return "本地文件";
    return "Meting";
  }

  function sourceChipText(source) {
    if (source.kind === "netease") return "网易云歌单";
    if (source.kind === "snapshot") return "网易云歌单";
    if (source.kind === "files") return "本地文件";
    return "导入歌单";
  }

  function defaultSourceName(source) {
    if (source.kind === "netease") return "网易云歌单 " + source.id;
    if (source.kind === "snapshot") return "默认歌单";
    if (source.kind === "files") return "本地音乐";
    return "导入歌单";
  }

  function saveSource(source) {
    if (!source || source.kind === "files") return;
    try {
      localStorage.setItem(LS_SOURCE, JSON.stringify({
        kind: source.kind,
        id: source.id || "",
        url: source.url || "",
        name: source.name || ""
      }));
    } catch (err) {}
  }

  function loadSavedSource() {
    try {
      var raw = localStorage.getItem(LS_SOURCE);
      if (!raw) return null;
      var source = JSON.parse(raw);
      if (!source || !source.kind) return null;
      if (source.kind === "files") return null;
      if (source.kind === "netease" && source.id === DEFAULT_NETEASE_ID) return null;
      return source;
    } catch (err) {
      return null;
    }
  }

  function setSourceUI() {
    var source = state.source || { kind: "files", name: "本地音乐" };
    var localOnly = source.kind === "files";
    els.sourceChip.textContent = sourceChipText(source) + (state.hasLocal && !localOnly ? " + 本地" : "");
    els.sourceLabel.textContent = sourceLabel(source) + (state.hasLocal && !localOnly ? " + 本地文件" : "");
    els.playlistName.textContent = source.name || defaultSourceName(source);
    els.queueBadge.textContent = localOnly ? "LOCAL" : "PLAYLIST";
    els.trackCount.textContent = String(state.playlist.length);
  }

  function loadSource(source, remember, silent) {
    if (!source.name) source.name = defaultSourceName(source);
    if (!silent) {
      state.loading = true;
      document.body.classList.add("is-loading");
      els.title.textContent = "加载歌单中…";
      els.artist.textContent = source.name || sourceChipText(source);
    }

    return fetchTracks(source)
      .then(function (tracks) {
        saveCache(source, tracks);

        if (silent && state.playlist.length) {
          // 后台刷新：只更新列表，不打断正在播放的音乐
          state.playlist = tracks;
          state.index = Math.min(state.index, tracks.length - 1);
          renderPlaylist();
          setSourceUI();
          primeDownloadUrls();
          return true;
        }

        state.source = source;
        state.playlist = tracks;
        state.index = 0;
        state.hasLocal = false;
        state.search = "";
        els.search.value = "";
        renderPlaylist();
        selectTrack(0, false);
        setSourceUI();
        primeDownloadUrls();
        if (remember) saveSource(source);
        toast("已加载 " + tracks.length + " 首歌曲");
        return true;
      })
      .catch(function (err) {
        console.error("[player]", err);
        if (silent) return false;
        toast("歌单加载失败：" + err.message);
        if (!state.playlist.length) {
          els.title.textContent = "歌单加载失败";
          els.artist.textContent = "点一下播放按钮可以重试，也可以导入其他歌单";
        }
        return false;
      })
      .finally(function () {
        state.loading = false;
        document.body.classList.remove("is-loading");
      });
  }

  function currentTrack() {
    return state.playlist[state.index] || null;
  }

  function updateCover(track) {
    var cover = (track && track.cover) || FALLBACK_COVER;
    els.cover.onerror = function () {
      els.cover.onerror = null;
      els.cover.src = FALLBACK_COVER;
    };
    els.cover.src = cover;
    els.bg.style.backgroundImage = 'url("' + cover.replace(/"/g, "%22") + '")';
  }

  function updateMediaSession(track) {
    if (!("mediaSession" in navigator) || !track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: track.artist,
        album: "cookiesky Music",
        artwork: [{ src: track.cover || FALLBACK_COVER, sizes: "512x512", type: "image/webp" }]
      });
    } catch (err) {}
  }

  function updateActiveItem() {
    var items = els.trackList.querySelectorAll(".track-item");
    Array.prototype.forEach.call(items, function (item) {
      var index = Number(item.dataset.index);
      item.classList.toggle("active", index === state.index);
    });
    var active = els.trackList.querySelector(".track-item.active");
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function selectTrack(index, autoplay) {
    if (!state.playlist.length) return;
    state.index = (index + state.playlist.length) % state.playlist.length;
    var track = currentTrack();
    if (!track) return;

    els.title.textContent = track.name;
    els.artist.textContent = track.artist;
    updateCover(track);
    updateActiveItem();
    updateMediaSession(track);
    document.title = track.name + " - cookiesky Music";

    els.progress.value = "0";
    setRange(els.progress, 0);
    els.currentTime.textContent = "00:00";
    els.duration.textContent = "00:00";

    // 不在选中时就加载音频，避免放着不动、链接过期后点播放失败
    state.trackLoaded = false;
    state.retried = false;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    if (autoplay) {
      startPlayback();
    } else {
      updatePlayState(false);
    }
  }

  function trackSrc(track) {
    if (!track) return "";
    // 优先用网易云外链：不依赖第三方接口，歌曲有版权就能直接播
    if (track.id) {
      return "https://music.163.com/song/media/outer/url?id=" + encodeURIComponent(track.id) + ".mp3";
    }
    return track.url;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ""));
  }

  function sanitizeFilename(value) {
    var name = String(value || "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "");
    if (name.length > 140) {
      var ext = "";
      var dot = name.lastIndexOf(".");
      if (dot > 0 && name.length - dot <= 6) {
        ext = name.slice(dot);
        name = name.slice(0, dot);
      }
      name = name.slice(0, 140 - ext.length) + ext;
    }
    return name || "audio.mp3";
  }

  function downloadFilename(track, prefix) {
    if (track.fileName) return sanitizeFilename(track.fileName);

    var base = String(track.name || "音频");
    if (track.artist && track.artist !== "未知歌手" && track.artist !== "本地文件") {
      base = track.artist + " - " + base;
    }

    var ext = ".mp3";
    var matched = String(track.url || "").split("?")[0].match(/\.(mp3|flac|m4a|aac|ogg|wav|ape)$/i);
    if (matched) ext = "." + matched[1].toLowerCase();

    return sanitizeFilename((prefix || "") + base + ext);
  }

  function resolveDownloadUrl(track) {
    if (!track) return Promise.reject(new Error("没有歌曲"));
    if (track.local && track.url) return Promise.resolve(track.url);
    if (track.id && downloadUrlCache[track.id]) return Promise.resolve(downloadUrlCache[track.id]);
    if (isHttpUrl(track.url)) {
      if (track.id) {
        downloadUrlCache[track.id] = track.url;
        saveDownloadUrls();
      }
      return Promise.resolve(track.url);
    }
    if (!track.id) return Promise.reject(new Error("没有可下载的地址"));

    // 只有歌曲 ID 时，向 Meting 单曲接口换取带 auth 的直链（该接口允许跨域）
    var apis = [activeApi].concat(APIS.filter(function (api) {
      return api !== activeApi;
    }));

    function tryApi(index, lastError) {
      if (index >= apis.length) {
        return Promise.reject(lastError || new Error("没有可下载的地址"));
      }
      return fetchJsonRetry(apis[index] + "?server=netease&type=song&id=" +
        encodeURIComponent(track.id) + "&r=" + Date.now(), SONG_TIMEOUT)
        .then(function (data) {
          var item = Array.isArray(data) ? data[0] : data;
          var url = item && item.url;
          if (!isHttpUrl(url)) throw new Error("没有可下载的地址");
          downloadUrlCache[track.id] = url;
          saveDownloadUrls();
          return url;
        })
        .catch(function (err) {
          return tryApi(index + 1, err);
        });
    }

    return tryApi(0, null);
  }

  function primeDownloadUrls() {
    state.playlist.forEach(function (track) {
      if (track && track.id && isHttpUrl(track.url)) {
        downloadUrlCache[track.id] = track.url;
      }
    });

    var missing = state.playlist.some(function (track) {
      return track && !track.local && track.id && !downloadUrlCache[track.id];
    });
    if (!missing) return Promise.resolve();

    var source = state.source || {};
    var url = "";
    if (source.kind === "netease") {
      url = activeApi + "?server=netease&type=playlist&id=" +
        encodeURIComponent(source.id) + "&r=" + Date.now();
    } else if (source.kind === "snapshot") {
      url = activeApi + "?server=netease&type=playlist&id=" +
        encodeURIComponent(DEFAULT_NETEASE_ID) + "&r=" + Date.now();
    } else if (source.kind === "meting" && source.url) {
      url = source.url;
    }
    if (!url) return Promise.resolve();

    return fetchJsonRetry(url, SONG_TIMEOUT).then(function (data) {
      normalizeTracks(data).forEach(function (track) {
        if (track.id && isHttpUrl(track.url)) {
          downloadUrlCache[track.id] = track.url;
        }
      });
      saveDownloadUrls();
    }).catch(function () {});
  }

  function fetchAudioBlob(url) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    downloadController = controller;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 180000);

    return fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.blob();
    }).finally(function () {
      clearTimeout(timer);
      downloadController = null;
    });
  }

  function fetchTrackBlob(track) {
    return resolveDownloadUrl(track).then(fetchAudioBlob).catch(function (err) {
      // 直链可能已失效：清掉缓存后重新解析一次
      if (!track || !track.id || !downloadUrlCache[track.id]) throw err;
      delete downloadUrlCache[track.id];
      saveDownloadUrls();
      return resolveDownloadUrl(track).then(fetchAudioBlob);
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  function openInNewTab(url) {
    if (!url) return;
    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function writeBlobToDir(dir, filename, blob) {
    return dir.getFileHandle(filename, { create: true })
      .then(function (handle) {
        return handle.createWritable();
      })
      .then(function (writable) {
        return writable.write(blob).then(function () {
          return writable.close();
        });
      });
  }

  function setBatchDownloadState(active, text) {
    if (!els.downloadAllBtn) return;
    els.downloadAllBtn.classList.toggle("is-busy", active);
    els.downloadAllText.textContent = text;
    els.downloadAllBtn.title = active ? "点击取消下载" : "下载当前列表（受搜索筛选影响）";
  }

  function visibleIndices() {
    var keyword = state.search.trim().toLowerCase();
    var indices = [];
    state.playlist.forEach(function (track, index) {
      if (!keyword) {
        indices.push(index);
        return;
      }
      var text = (track.name + " " + track.artist).toLowerCase();
      if (text.indexOf(keyword) !== -1) indices.push(index);
    });
    return indices;
  }

  function downloadTrack(track, button) {
    if (!track) {
      toast("还没有可以下载的歌曲");
      return;
    }
    if (button) {
      button.disabled = true;
      button.classList.add("is-busy");
    }

    fetchTrackBlob(track)
      .then(function (blob) {
        saveBlob(blob, downloadFilename(track));
        toast("正在下载「" + track.name + "」");
      })
      .catch(function (err) {
        console.warn("[player] 下载失败", err);
        openInNewTab(trackSrc(track) || track.url);
        toast("无法直接下载，已在新标签页打开");
      })
      .finally(function () {
        if (button) {
          button.disabled = false;
          button.classList.remove("is-busy");
        }
      });
  }

  function downloadBatch() {
    if (state.downloading) {
      state.downloadCancel = true;
      if (downloadController) downloadController.abort();
      setBatchDownloadState(true, "正在取消…");
      return;
    }

    var indices = visibleIndices();
    if (!indices.length) {
      toast("当前列表没有歌曲");
      return;
    }

    function begin(dir) {
      state.downloading = true;
      state.downloadCancel = false;
      var ok = 0;
      var fail = 0;
      var total = indices.length;

      function finish() {
        var cancelled = state.downloadCancel;
        state.downloading = false;
        state.downloadCancel = false;
        setBatchDownloadState(false, "批量下载");
        if (cancelled) toast("已取消下载，已完成 " + ok + " 首");
        else if (fail) toast("下载完成：成功 " + ok + " 首，失败 " + fail + " 首");
        else toast("已下载 " + ok + " 首歌曲");
      }

      function step(pos) {
        if (pos >= total || state.downloadCancel) {
          finish();
          return;
        }

        var track = state.playlist[indices[pos]];
        setBatchDownloadState(true, "取消下载 (" + (pos + 1) + "/" + total + ")");

        fetchTrackBlob(track)
          .then(function (blob) {
            var prefix = String(pos + 1).padStart(2, "0") + " - ";
            var filename = downloadFilename(track, prefix);
            if (dir) {
              return writeBlobToDir(dir, filename, blob).catch(function () {
                saveBlob(blob, filename);
              });
            }
            saveBlob(blob, filename);
            return sleep(220);
          })
          .then(function () {
            ok += 1;
          })
          .catch(function (err) {
            if (state.downloadCancel || (err && err.name === "AbortError")) return;
            fail += 1;
            console.warn("[player] 批量下载失败", track && track.name, err);
          })
          .then(function () {
            step(pos + 1);
          });
      }

      setBatchDownloadState(true, "准备下载…");
      primeDownloadUrls().then(function () {
        step(0);
      });
    }

    if (window.showDirectoryPicker && window.isSecureContext) {
      window.showDirectoryPicker({ mode: "readwrite" })
        .then(begin)
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          toast("无法选择文件夹，改为逐个下载");
          begin(null);
        });
      return;
    }

    toast("将下载 " + indices.length + " 首，浏览器可能询问是否允许下载多个文件");
    setTimeout(function () {
      begin(null);
    }, 350);
  }

  function startPlayback(forceReload) {
    var track = currentTrack();
    if (!track) {
      toast("歌单还没加载完成");
      return;
    }

    if (forceReload || !state.trackLoaded) {
      state.trackLoaded = true;
      state.retried = false;
      audio.src = trackSrc(track);
      audio.load();
    }

    audio.play().catch(function (err) {
      if (err && err.name === "NotAllowedError") {
        updatePlayState(false);
        toast("浏览器拦截了播放，请再点一次播放按钮");
      }
      // 其余的加载/解码失败交给 audio 的 error 事件处理，避免重复触发
    });
    armPlayWatch();
  }

  function recoverTrack() {
    var track = currentTrack();
    if (!track) return;

    if (!state.retried) {
      state.retried = true;
      audio.src = trackSrc(track);
      audio.load();
      audio.play().catch(function () {});
      armPlayWatch();
      return;
    }

    state.skipCount = (state.skipCount || 0) + 1;
    updatePlayState(false);

    if (state.skipCount > 5) {
      state.skipCount = 0;
      toast("连着几首都播不了，这个歌单可能受版权限制");
      return;
    }

    toast("「" + track.name + "」无法播放，自动跳过");
    setTimeout(function () {
      nextTrack(true);
    }, 350);
  }

  function updatePlayState(playing) {
    document.body.classList.toggle("is-playing", playing);
    els.playIcon.innerHTML = '<use href="#' + (playing ? "i-pause" : "i-play") + '"/>';
    els.playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
  }

  function togglePlay() {
    if (!state.playlist.length) {
      retryLoad();
      return;
    }
    if (audio.paused) {
      startPlayback();
    } else {
      audio.pause();
    }
  }

  function retryLoad() {
    if (state.loading) {
      toast("歌单还在加载中…");
      return;
    }
    state.loading = true;
    toast("正在重新加载歌单…");
    loadSource(state.source || DEFAULT_SOURCE, false).then(function () {
      state.loading = false;
    });
  }

  function nextTrack(auto) {
    if (!state.playlist.length) return;

    if (state.repeat === "one" && auto) {
      audio.currentTime = 0;
      startPlayback(true);
      return;
    }

    if (state.shuffle) {
      if (state.playlist.length === 1) {
        selectTrack(state.index, true);
        return;
      }
      var next = state.index;
      while (next === state.index) {
        next = Math.floor(Math.random() * state.playlist.length);
      }
      selectTrack(next, true);
      return;
    }

    if (state.index === state.playlist.length - 1) {
      if (state.repeat === "all" || !auto) selectTrack(0, true);
      else updatePlayState(false);
      return;
    }
    selectTrack(state.index + 1, true);
  }

  function prevTrack() {
    if (!state.playlist.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    selectTrack(state.index - 1, true);
  }

  function renderPlaylist() {
    els.trackList.innerHTML = "";
    var keyword = state.search.trim().toLowerCase();
    var shown = 0;

    state.playlist.forEach(function (track, index) {
      if (keyword) {
        var text = (track.name + " " + track.artist).toLowerCase();
        if (text.indexOf(keyword) === -1) return;
      }
      shown++;

      var li = document.createElement("li");
      li.className = "track-item" + (index === state.index ? " active" : "");
      li.dataset.index = String(index);

      var idx = document.createElement("span");
      idx.className = "track-index";
      idx.textContent = String(index + 1).padStart(2, "0");

      var text = document.createElement("div");
      text.className = "track-text";
      var name = document.createElement("div");
      name.className = "track-name";
      name.textContent = track.name;
      var artist = document.createElement("div");
      artist.className = "track-artist";
      artist.textContent = track.artist;
      text.appendChild(name);
      text.appendChild(artist);

      var bars = document.createElement("span");
      bars.className = "track-bars";
      bars.innerHTML = "<i></i><i></i><i></i>";

      var download = document.createElement("button");
      download.type = "button";
      download.className = "track-dl";
      download.title = "下载这首";
      download.setAttribute("aria-label", "下载 " + track.name);
      download.innerHTML = '<svg class="icon"><use href="#i-download"/></svg>';
      download.addEventListener("click", function (event) {
        event.stopPropagation();
        downloadTrack(track, download);
      });

      li.appendChild(idx);
      li.appendChild(text);
      li.appendChild(bars);
      li.appendChild(download);
      li.addEventListener("click", function () {
        selectTrack(index, true);
      });
      els.trackList.appendChild(li);
    });

    els.queueEmpty.hidden = shown > 0;
    if (!shown) els.queueEmpty.textContent = keyword ? "没有匹配的歌曲" : "暂无歌曲";
    els.trackCount.textContent = String(state.playlist.length);
    updateActiveItem();
  }

  function parseImport(value) {
    var input = value.trim();
    if (!input) return null;

    var idMatch = input.match(/[?&#]id=(\d+)/);
    if (idMatch) return { kind: "netease", id: idMatch[1] };

    if (/^\d{5,}$/.test(input)) return { kind: "netease", id: input };

    if (/^https?:\/\//i.test(input)) {
      if (/music\.163\.com/i.test(input)) {
        var m = input.match(/id=(\d+)/);
        if (m) return { kind: "netease", id: m[1] };
      }
      if (/\.json(\?|$)/i.test(input)) return { kind: "json", url: input };
      if (/api\.i-meto\.com|type=playlist|meting/i.test(input)) {
        return { kind: "meting", url: input };
      }
    }

    return null;
  }

  function openEl(el) {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
  }

  function closeEl(el) {
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
  }

  function openModal() {
    openEl(els.importModal);
    setTimeout(function () {
      els.importInput.focus();
    }, 120);
  }

  function closeModal() {
    closeEl(els.importModal);
  }

  function importPlaylist() {
    var source = parseImport(els.importInput.value);
    if (!source) {
      toast("格式不对，请输入歌单 ID、歌单链接或 Meting 歌单 API");
      return;
    }
    if (source.kind === "json") {
      toast("正在加载歌单…");
      loadSource(source, true).then(function (ok) {
        if (ok) {
          closeModal();
          els.importInput.value = "";
        }
      });
      return;
    }
    loadSource(source, true).then(function (ok) {
      if (ok) {
        closeModal();
        els.importInput.value = "";
      }
    });
  }

  function parseLocalFiles(fileList) {
    return Array.prototype.slice.call(fileList || []).map(function (file) {
      var localeBase = file.name.replace(/\.[^.]+$/, "");
      var parts = localeBase.split(" - ");
      var artist = parts.length > 1 ? parts.shift().trim() : "本地文件";
      var title = parts.join(" - ").trim() || localeBase;
      return {
        name: title,
        artist: artist,
        url: URL.createObjectURL(file),
        cover: FALLBACK_COVER,
        fileName: file.name,
        local: true
      };
    });
  }

  function handleFiles(fileList) {
    var tracks = parseLocalFiles(fileList);
    if (!tracks.length) return;

    if (!state.playlist.length) {
      applyLocalTracks(tracks, "replace");
      return;
    }

    state.pendingTracks = tracks;
    els.addCount.textContent = String(tracks.length);
    openEl(els.addModeModal);
  }

  function applyLocalTracks(tracks, mode) {
    state.pendingTracks = [];

    if (mode === "replace" || !state.playlist.length) {
      state.playlist = tracks.slice();
      state.source = { kind: "files", name: "本地音乐" };
      state.hasLocal = true;
      state.index = 0;
      state.search = "";
      els.search.value = "";
      renderPlaylist();
      selectTrack(0, true);
      setSourceUI();
      toast("已替换为 " + tracks.length + " 首本地音乐");
      return;
    }

    state.playlist = state.playlist.concat(tracks);
    state.hasLocal = true;
    renderPlaylist();
    setSourceUI();
    toast("已追加 " + tracks.length + " 首到歌单末尾");
  }

  function cycleRepeat() {
    if (state.repeat === "all") state.repeat = "one";
    else if (state.repeat === "one") state.repeat = "off";
    else state.repeat = "all";

    els.repeatBtn.classList.toggle("active", state.repeat !== "off");
    els.repeatIcon.innerHTML = '<use href="#' + (state.repeat === "one" ? "i-repeat-one" : "i-repeat") + '"/>';
    els.repeatBtn.title = state.repeat === "all" ? "列表循环" : state.repeat === "one" ? "单曲循环" : "不循环";
    try {
      localStorage.setItem(LS_REPEAT, state.repeat);
    } catch (err) {}
    toast(els.repeatBtn.title);
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    els.shuffleBtn.classList.toggle("active", state.shuffle);
    try {
      localStorage.setItem(LS_SHUFFLE, state.shuffle ? "1" : "0");
    } catch (err) {}
    toast(state.shuffle ? "随机播放已开启" : "随机播放已关闭");
  }

  function setVolume(value) {
    var volume = clamp(value, 0, 1);
    state.volume = volume;
    audio.volume = volume;
    els.volume.value = String(Math.round(volume * 100));
    setRange(els.volume, volume * 100);
    els.volumeIcon.innerHTML = '<use href="#' + (volume === 0 ? "i-mute" : "i-volume") + '"/>';
    try {
      localStorage.setItem(LS_VOLUME, String(volume));
    } catch (err) {}
  }

  function bindEvents() {
    els.playBtn.addEventListener("click", togglePlay);
    els.prevBtn.addEventListener("click", prevTrack);
    els.nextBtn.addEventListener("click", function () {
      nextTrack(false);
    });
    els.shuffleBtn.addEventListener("click", toggleShuffle);
    els.repeatBtn.addEventListener("click", cycleRepeat);
    els.muteBtn.addEventListener("click", function () {
      setVolume(state.volume > 0 ? 0 : 0.8);
    });
    els.downloadAllBtn.addEventListener("click", downloadBatch);
    els.downloadCurrentBtn.addEventListener("click", function () {
      downloadTrack(currentTrack(), els.downloadCurrentBtn);
    });

    els.progress.addEventListener("input", function () {
      var duration = audio.duration;
      if (!isFinite(duration) || duration <= 0) return;
      audio.currentTime = (Number(els.progress.value) / 1000) * duration;
    });

    els.volume.addEventListener("input", function () {
      setVolume(Number(els.volume.value) / 100);
    });

    els.search.addEventListener("input", function () {
      state.search = els.search.value;
      renderPlaylist();
    });

    els.importBtn.addEventListener("click", openModal);
    els.closeModal.addEventListener("click", closeModal);
    els.importModal.addEventListener("click", function (event) {
      if (event.target === els.importModal) closeModal();
    });
    els.importConfirm.addEventListener("click", importPlaylist);
    els.importInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") importPlaylist();
    });
    els.useDefault.addEventListener("click", function () {
      loadSource(DEFAULT_SOURCE, true).then(function (ok) {
        if (ok) closeModal();
      });
    });

    els.localFileBtn.addEventListener("click", function () {
      els.fileInput.click();
    });
    els.fileInput.addEventListener("change", function () {
      handleFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.closeAddMode.addEventListener("click", function () {
      state.pendingTracks = [];
      closeEl(els.addModeModal);
    });
    els.addModeModal.addEventListener("click", function (event) {
      if (event.target === els.addModeModal) {
        state.pendingTracks = [];
        closeEl(els.addModeModal);
      }
    });
    els.addAppend.addEventListener("click", function () {
      applyLocalTracks(state.pendingTracks, "append");
      closeEl(els.addModeModal);
    });
    els.addReplace.addEventListener("click", function () {
      applyLocalTracks(state.pendingTracks, "replace");
      closeEl(els.addModeModal);
    });

    audio.addEventListener("play", function () {
      updatePlayState(true);
    });
    audio.addEventListener("playing", function () {
      state.skipCount = 0;
      clearTimeout(playWatch);
      updatePlayState(true);
    });
    audio.addEventListener("pause", function () {
      clearTimeout(playWatch);
      updatePlayState(false);
    });
    audio.addEventListener("timeupdate", function () {
      var duration = audio.duration;
      if (!isFinite(duration) || duration <= 0) return;
      var percent = (audio.currentTime / duration) * 100;
      els.progress.value = String(Math.round(percent * 10));
      setRange(els.progress, percent);
      els.currentTime.textContent = formatTime(audio.currentTime);
    });
    audio.addEventListener("loadedmetadata", function () {
      els.duration.textContent = formatTime(audio.duration);
    });
    audio.addEventListener("ended", function () {
      nextTrack(true);
    });
    audio.addEventListener("error", function () {
      if (!state.trackLoaded) return;
      if (audio.error && audio.error.code === 1) return; // 被新的加载打断，忽略
      updatePlayState(false);
      recoverTrack();
    });

    document.addEventListener("keydown", function (event) {
      var tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (els.importModal.classList.contains("open") || els.addModeModal.classList.contains("open")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowRight") {
        if (isFinite(audio.duration)) audio.currentTime = clamp(audio.currentTime + 5, 0, audio.duration);
      } else if (event.code === "ArrowLeft") {
        if (isFinite(audio.duration)) audio.currentTime = clamp(audio.currentTime - 5, 0, audio.duration);
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        setVolume(state.volume + 0.05);
      } else if (event.code === "ArrowDown") {
        event.preventDefault();
        setVolume(state.volume - 0.05);
      } else if (event.key.toLowerCase() === "m") {
        setVolume(state.volume > 0 ? 0 : 0.8);
      } else if (event.key.toLowerCase() === "n") {
        nextTrack(false);
      } else if (event.key.toLowerCase() === "p") {
        prevTrack();
      }
    });

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
        navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
        navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
        navigator.mediaSession.setActionHandler("nexttrack", function () { nextTrack(false); });
        navigator.mediaSession.setActionHandler("seekbackward", function () {
          audio.currentTime = clamp(audio.currentTime - 10, 0, audio.duration || 0);
        });
        navigator.mediaSession.setActionHandler("seekforward", function () {
          audio.currentTime = clamp(audio.currentTime + 10, 0, audio.duration || 0);
        });
      } catch (err) {}
    }
  }

  function restorePreferences() {
    try {
      var volume = parseFloat(localStorage.getItem(LS_VOLUME));
      if (isFinite(volume)) state.volume = clamp(volume, 0, 1);
      state.shuffle = localStorage.getItem(LS_SHUFFLE) === "1";
      var repeat = localStorage.getItem(LS_REPEAT);
      if (repeat === "all" || repeat === "one" || repeat === "off") state.repeat = repeat;
    } catch (err) {}

    audio.volume = state.volume;
    els.volume.value = String(Math.round(state.volume * 100));
    setRange(els.volume, state.volume * 100);
    els.shuffleBtn.classList.toggle("active", state.shuffle);
    els.repeatBtn.classList.toggle("active", state.repeat !== "off");
    els.repeatIcon.innerHTML = '<use href="#' + (state.repeat === "one" ? "i-repeat-one" : "i-repeat") + '"/>';
    els.repeatBtn.title = state.repeat === "all" ? "列表循环" : state.repeat === "one" ? "单曲循环" : "不循环";
  }

  function init() {
    cacheEls();
    bindEvents();
    restorePreferences();
    restoreDownloadUrls();

    var saved = loadSavedSource();
    var source = saved || DEFAULT_SOURCE;
    var cache = readCache();

    // 先用本地缓存的歌单渲染，再用线上数据静默刷新；接口挂了也还能继续听
    if (cache && sourceKey(cache.source) === sourceKey(source)) {
      state.source = source;
      state.playlist = cache.tracks;
      state.index = 0;
      renderPlaylist();
      selectTrack(0, false);
      setSourceUI();
      loadSource(source, false, true);
      return;
    }

    state.loading = true;
    loadSource(source, !saved).then(function () {
      state.loading = false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
