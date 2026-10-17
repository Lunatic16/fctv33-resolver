type LiveMatch = { matchId: number; sportType: number; name: string };
type ResolveResult = {
  name?: string;
  streamUrl?: string;
  playableUrl?: string;
  referer?: string;
  error?: string;
};
type HlsPlayer = {
  destroy: () => void;
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
};
type HlsApi = {
  isSupported: () => boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string };
  new (config?: Record<string, unknown>): HlsPlayer;
};

declare const Hls: HlsApi;

const SPORTS = [
  { type: 1, label: "Football" },
  { type: 2, label: "Basketball" },
  { type: 3, label: "Tennis" },
  { type: 4, label: "Baseball" },
  { type: 6, label: "Cricket" },
  { type: 7, label: "Motorsport" },
  { type: 8, label: "Rugby" },
  { type: 9, label: "Am. Football" },
  { type: 11, label: "Hockey" },
  { type: 90, label: "Others" },
] as const;

const el = {
  sports: document.getElementById("sport-tabs")!,
  refresh: document.getElementById("refresh-button") as HTMLButtonElement,
  liveMeta: document.getElementById("live-meta")!,
  status: document.querySelector(".status") as HTMLElement,
  matches: document.getElementById("match-list")!,
  title: document.getElementById("stream-title")!,
  screen: document.querySelector(".screen") as HTMLElement,
  video: document.getElementById("video-element") as HTMLVideoElement,
  exports: document.getElementById("exports")!,
  error: document.getElementById("error-message")!,
  direct: document.getElementById("export-direct-url") as HTMLInputElement,
  proxied: document.getElementById("export-proxied-url") as HTMLInputElement,
  m3uCopy: document.getElementById("m3u-copy") as HTMLButtonElement,
  timing: document.getElementById("timing-panel")!,
  resolveMs: document.getElementById("timing-resolve")!,
  playMs: document.getElementById("timing-play")!,
};

const state = {
  sportType: 1,
  matches: [] as LiveMatch[],
  activeId: null as number | null,
  loading: false,
  resolving: false,
  hls: null as HlsPlayer | null,
  gen: 0,
  timer: null as null | {
    frame: number;
    markResolved: () => void;
    markPlayed: () => void;
  },
};

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);

const showError = (message: string) => {
  el.error.textContent = message;
  el.error.hidden = false;
};

const clearError = () => {
  el.error.hidden = true;
  el.error.textContent = "";
};

const setIdle = () => {
  el.screen.classList.remove("is-active");
  el.video.hidden = true;
  el.exports.hidden = true;
  el.title.textContent = "Select a Match";
  el.timing.hidden = true;
  el.direct.value = el.proxied.value = "";
};

const setPlaying = () => {
  el.screen.classList.add("is-active");
  el.video.hidden = false;
  el.exports.hidden = false;
};

const stopTiming = () => {
  if (!state.timer) return;
  cancelAnimationFrame(state.timer.frame);
  state.timer = null;
};

const startTiming = () => {
  stopTiming();
  el.timing.hidden = false;
  el.resolveMs.textContent = "0ms";
  el.playMs.textContent = "waiting";
  el.resolveMs.className = "timing__v is-live";
  el.playMs.className = "timing__v";
  const started = performance.now();
  let resolvedAt: number | null = null;
  let playedAt: number | null = null;
  const tick = () => {
    const now = performance.now();
    if (resolvedAt == null) el.resolveMs.textContent = formatMs(now - started);
    if (resolvedAt != null && playedAt == null) {
      el.playMs.textContent = formatMs(now - resolvedAt);
      el.playMs.className = "timing__v is-live";
    }
    if (playedAt == null && state.timer) state.timer.frame = requestAnimationFrame(tick);
  };
  state.timer = {
    frame: requestAnimationFrame(tick),
    markResolved() {
      if (resolvedAt != null) return;
      resolvedAt = performance.now();
      el.resolveMs.textContent = formatMs(resolvedAt - started);
      el.resolveMs.className = "timing__v is-done";
      el.playMs.textContent = "0ms";
      el.playMs.className = "timing__v is-live";
    },
    markPlayed() {
      if (playedAt != null) return;
      playedAt = performance.now();
      if (resolvedAt == null) this.markResolved();
      el.playMs.textContent = formatMs(playedAt - (resolvedAt as number));
      el.playMs.className = "timing__v is-done";
      stopTiming();
    },
  };
  return state.timer;
};

const stopPlayback = () => {
  state.gen += 1;
  state.hls?.destroy();
  state.hls = null;
  el.video.pause();
  el.video.removeAttribute("src");
  el.video.load();
};

const startPlayback = (url: string, timing: NonNullable<typeof state.timer>) => {
  stopPlayback();
  const gen = state.gen;
  const current = () => gen === state.gen;
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (ok: boolean, error?: Error) => {
      if (!current() || done) return;
      done = true;
      el.video.removeEventListener("playing", onPlaying);
      el.video.removeEventListener("error", onError);
      if (ok) {
        clearError();
        timing.markPlayed();
        resolve();
      } else reject(error ?? new Error("playback failed"));
    };
    const onPlaying = () => finish(true);
    const onError = () => finish(false, new Error("playback failed"));
    el.video.addEventListener("playing", onPlaying);
    el.video.addEventListener("error", onError);

    if (Hls.isSupported()) {
      state.hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      state.hls.on(Hls.Events.ERROR, (_e, data) => {
        if ((data as { fatal?: boolean } | undefined)?.fatal) finish(false, new Error("playback failed"));
      });
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (current()) void el.video.play().catch(() => undefined);
      });
      state.hls.attachMedia(el.video);
      state.hls.loadSource(url);
      return;
    }
    if (el.video.canPlayType("application/vnd.apple.mpegurl")) {
      el.video.src = url;
      void el.video.play().catch(() => undefined);
      return;
    }
    finish(false, new Error("HLS not supported"));
  });
};

const bindExports = (result: ResolveResult) => {
  el.direct.value = result.streamUrl ?? "";
  el.proxied.value = result.playableUrl ?? "";
};

const renderSports = () => {
  el.sports.replaceChildren(
    ...SPORTS.map((sport) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sports__btn${sport.type === state.sportType ? " is-active" : ""}`;
      button.textContent = sport.label;
      button.onclick = () => {
        if (state.sportType === sport.type) return;
        state.sportType = sport.type;
        renderSports();
        void loadMatches();
      };
      return button;
    }),
  );
};

const renderMatches = () => {
  el.matches.replaceChildren(
    ...state.matches.map((match) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `match${match.matchId === state.activeId ? " is-active" : ""}`;
      button.disabled = state.resolving;
      const title = document.createElement("span");
      title.className = "match__title";
      title.textContent = match.name || `Match ${match.matchId}`;
      const meta = document.createElement("span");
      meta.className = "match__meta";
      meta.textContent = `#${match.matchId}`;
      button.append(title, meta);
      button.onclick = () => void playMatch(match);
      item.append(button);
      return item;
    }),
  );
  if (!state.matches.length && !state.loading) {
    const empty = document.createElement("li");
    empty.className = "matches__empty";
    empty.textContent = "No live streams for this sport right now.";
    el.matches.append(empty);
  }
};

const loadMatches = async () => {
  state.loading = true;
  el.refresh.disabled = true;
  el.status.className = "status is-loading";
  el.liveMeta.textContent = "Loading…";
  clearError();
  renderMatches();
  try {
    const response = await fetch(`/api/live?sportType=${state.sportType}`);
    const result = (await response.json()) as { matches?: LiveMatch[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
    state.matches = result.matches ?? [];
    el.status.className = "status";
    el.liveMeta.textContent = `${state.matches.length} live`;
  } catch (error) {
    state.matches = [];
    el.status.className = "status is-error";
    el.liveMeta.textContent = "Failed";
    showError(error instanceof Error ? error.message : "Live list failed");
  } finally {
    state.loading = false;
    el.refresh.disabled = false;
    renderMatches();
  }
};

const playMatch = async (match: LiveMatch) => {
  if (state.resolving) return;
  state.resolving = true;
  state.activeId = match.matchId;
  clearError();
  stopPlayback();
  stopTiming();
  setIdle();
  el.title.textContent = match.name || `Match ${match.matchId}`;
  renderMatches();
  const timing = startTiming();
  try {
    const response = await fetch(
      `/api/resolve?matchId=${encodeURIComponent(match.matchId)}&sportType=${encodeURIComponent(match.sportType)}`,
    );
    const result = (await response.json()) as ResolveResult;
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
    el.title.textContent = result.name || match.name || "Stream";
    bindExports(result);
    setPlaying();
    timing.markResolved();
    if (!result.playableUrl) throw new Error("missing playable url");
    await startPlayback(result.playableUrl, timing);
  } catch (error) {
    stopTiming();
    el.timing.hidden = true;
    setIdle();
    el.title.textContent = match.name || "Select a Match";
    showError(error instanceof Error ? error.message : "Resolve failed");
  } finally {
    state.resolving = false;
    renderMatches();
  }
};

const copyText = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      // Some embedded webviews leave the clipboard promise pending forever —
      // race it with a timeout so the execCommand fallback still runs.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("clipboard timeout")), 1500);
        navigator.clipboard.writeText(text).then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error("clipboard rejected"));
          },
        );
      });
      return true;
    } catch {
      // Insecure origin (plain-HTTP LAN), permission denied, or timeout.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
};

const flashButton = (button: HTMLButtonElement, ok: boolean, label: string) => {
  button.textContent = ok ? "Copied" : "Copy failed";
  button.classList.add(ok ? "ok" : "fail");
  setTimeout(() => {
    button.textContent = label;
    button.classList.remove(ok ? "ok" : "fail");
  }, 1100);
};

document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
  button.onclick = async () => {
    const field = document.getElementById(button.dataset.copy ?? "") as HTMLInputElement | null;
    if (!field?.value) return;
    flashButton(button, await copyText(field.value), "Copy");
  };
});

el.m3uCopy.onclick = async () => {
  el.m3uCopy.disabled = true;
  try {
    // Copy the playlist URL (not its contents) so IPTV clients can subscribe to it.
    const playlistUrl = `${location.origin}/playlist.m3u`;
    flashButton(el.m3uCopy, await copyText(playlistUrl), "Copy M3U");
  } catch {
    flashButton(el.m3uCopy, false, "Copy M3U");
  } finally {
    el.m3uCopy.disabled = false;
  }
};

el.refresh.onclick = () => void loadMatches();
setIdle();
renderSports();
void loadMatches();
