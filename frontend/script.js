// ============================================================
// WAVELENGTH — front-end logic
// Backend: api_server.py (FastAPI + JWT auth + MongoDB Atlas)
// ============================================================

const API_BASE = "http://localhost:8000";
const TOKEN_KEY = "wavelength:token";

const state = {
  sourceType: "url",
  file: null,
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  demo: false,
  sessionId: null,
  analysisId: null,
  result: null,
};

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function makeBars(container, count) {
  container.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.animationDuration = `${(0.7 + Math.random() * 0.9).toFixed(2)}s`;
    bar.style.animationDelay = `${(Math.random() * 1).toFixed(2)}s`;
    frag.appendChild(bar);
  }
  container.appendChild(frag);
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).replace(/^[-*\u2022\d.)\s]+/, "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((l) => l.replace(/^[-*\u2022\d.)\s]+/, "").trim()).filter(Boolean);
  }
  return [];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

makeBars($("#ambientWave"), 28);

// ================================================================
// AUTH
// ================================================================

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

// Wraps fetch with the auth header + API_BASE, and forces a re-login on 401.
async function authedFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() },
  });
  if (res.status === 401 && !state.demo) {
    logout("Your session expired — please log in again.");
  }
  return res;
}

function setToken(token) {
  state.token = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function logout(message) {
  setToken(null);
  state.user = null;
  state.sessionId = null;
  state.analysisId = null;
  state.result = null;
  $("#top").hidden = true;
  toggleNavAuthUi(false);
  resetAuthForm();
  showAuthGate(message);
}

// Clears every field and puts the auth card back to a fresh "Log in" state —
// called on logout so the next person (or you, next time) doesn't see
// whatever was last typed in.
function resetAuthForm() {
  $("#authForm").reset();
  $("#authHint").textContent = "";
  authMode = "login";
  $$(".auth-tab").forEach((t) => {
    const isLogin = t.dataset.auth === "login";
    t.classList.toggle("is-active", isLogin);
    t.setAttribute("aria-selected", String(isLogin));
  });
  $("#authSubmitLabel").textContent = "Log in";
  $("#authNameCollapse").classList.add("is-collapsed");
  $("#authPassword").type = "password";
  $("#authPasswordToggle").setAttribute("aria-pressed", "false");
  $("#authPasswordToggle").setAttribute("aria-label", "Show password");
  $(".eye-open", $("#authPasswordToggle")).hidden = false;
  $(".eye-closed", $("#authPasswordToggle")).hidden = true;
}

function toggleNavAuthUi(loggedIn) {
  $("#historyBtn").hidden = !loggedIn;
  $("#accountMenu").hidden = !loggedIn;
  if (!loggedIn) $("#accountDropdown").hidden = true;
}

function showAuthGate(message) {
  $("#bootLoading").hidden = true;
  $("#authOverlay").classList.remove("is-leaving");
  $("#authOverlay").hidden = false;
  $("#authHint").textContent = message || "";
  if (message) shakeAuthCard();
}

function shakeAuthCard() {
  const card = $("#authCard");
  card.classList.remove("is-shake");
  // force reflow so the animation can retrigger on repeated errors
  void card.offsetWidth;
  card.classList.add("is-shake");
}

async function enterApp({ demo }) {
  state.demo = demo;
  const overlay = $("#authOverlay");
  $("#bootLoading").hidden = true;
  // Only play the fade-out if the overlay was actually visible (a real login
  // just happened). If we're restoring an already-valid session on reload,
  // it was hidden the whole time — animating it out would just add a
  // pointless 320ms delay before the app appears.
  if (!overlay.hidden) {
    overlay.classList.add("is-leaving");
    await sleep(320);
    overlay.classList.remove("is-leaving");
  }
  overlay.hidden = true;
  $("#top").hidden = false;
  toggleNavAuthUi(!demo);
  if (!demo && state.user) {
    const displayName = state.user.name || state.user.email;
    $("#accountAvatar").textContent = (displayName[0] || "?").toUpperCase();
    $("#accountName").textContent = state.user.name || state.user.email;
    $("#accountEmail").textContent = state.user.email;
  }
}

async function bootstrap() {
  consumeOAuthRedirectToken();
  loadOAuthProviders(); // fire and forget — doesn't block showing the login form

  if (state.token) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        state.user = data.user;
        await enterApp({ demo: false });
        return;
      }
      setToken(null); // expired/invalid
    } catch (err) {
      if (err instanceof TypeError) {
        await enterApp({ demo: true }); // backend unreachable — go straight to demo mode
        return;
      }
    }
  }

  // No valid token — see whether a backend even exists before forcing login.
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      showAuthGate();
      return;
    }
  } catch (err) {
    if (err instanceof TypeError) {
      await enterApp({ demo: true });
      return;
    }
  }
  showAuthGate();
}

// If we just landed here from an OAuth redirect, api_server.py appended
// ?token=... to the URL. Grab it, store it, and clean the URL bar.
function consumeOAuthRedirectToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return;
  setToken(token);
  params.delete("token");
  const clean = window.location.pathname + (params.toString() ? `?${params}` : "") + window.location.hash;
  window.history.replaceState({}, "", clean);
}

const OAUTH_ICONS = {
  google: `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.284-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/></svg>`,
  microsoft: `<svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>`,
  apple: `<svg width="16" height="16" viewBox="0 0 814 1000" fill="#000"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-163.9-39.5c-76.4 0-103.5 40.8-165.9 40.8s-105.8-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/></svg>`,
};
const OAUTH_LABELS = { google: "Continue with Google", microsoft: "Continue with Microsoft", apple: "Continue with Apple" };

async function loadOAuthProviders() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/providers`);
    if (!res.ok) return;
    const { providers } = await res.json();
    if (!providers.length) return;

    const container = $("#oauthButtons");
    container.innerHTML = "";
    providers.forEach((p) => {
      const a = document.createElement("a");
      a.className = "oauth-btn";
      a.href = `${API_BASE}/api/auth/oauth/${p}/login`;
      a.innerHTML = `${OAUTH_ICONS[p] || ""}<span>${OAUTH_LABELS[p] || `Continue with ${p}`}</span>`;
      container.appendChild(a);
    });
    container.hidden = false;
    $("#authDivider").hidden = false;
  } catch {
    // backend unreachable — just don't show social buttons, demo mode still works
  }
}

// --- auth form (login / register tabs) ---
let authMode = "login";
$$(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".auth-tab").forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    authMode = tab.dataset.auth;
    $("#authSubmitLabel").textContent = authMode === "login" ? "Log in" : "Create account";
    $("#authPassword").autocomplete = authMode === "login" ? "current-password" : "new-password";
    $("#authNameCollapse").classList.toggle("is-collapsed", authMode !== "register");
    $("#authName").required = authMode === "register";
    $("#authHint").textContent = "";
  });
});

// --- show/hide password ---
const passwordToggle = $("#authPasswordToggle");
const passwordInput = $("#authPassword");
passwordToggle.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  passwordToggle.setAttribute("aria-pressed", String(!showing));
  passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  $(".eye-open", passwordToggle).hidden = !showing;
  $(".eye-closed", passwordToggle).hidden = showing;
  passwordInput.focus();
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#authName").value.trim();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const hint = $("#authHint");
  const submitBtn = $("#authSubmit");
  hint.textContent = "";

  if (password.length < 8) {
    hint.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (authMode === "register" && !name) {
    hint.textContent = "Please enter your name.";
    $("#authName").focus();
    return;
  }

  submitBtn.disabled = true;
  try {
    const body = authMode === "register" ? { email, password, name } : { email, password };
    const res = await fetch(`${API_BASE}/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      hint.textContent = data.detail || "Something went wrong — try again.";
      return;
    }
    setToken(data.token);
    state.user = data.user;
    enterApp({ demo: false });
  } catch (err) {
    if (err instanceof TypeError) {
      hint.textContent = "Can't reach the backend. Start api_server.py, or continue in demo mode below.";
    } else {
      hint.textContent = err.message;
    }
  } finally {
    submitBtn.disabled = false;
  }
});

$("#continueDemoBtn").addEventListener("click", () => enterApp({ demo: true }));
$("#logoutBtn").addEventListener("click", () => logout());

// --- account menu dropdown ---
const accountTrigger = $("#accountTrigger");
const accountDropdown = $("#accountDropdown");
accountTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = accountDropdown.hidden;
  accountDropdown.hidden = !willOpen;
  accountTrigger.setAttribute("aria-expanded", String(willOpen));
});
document.addEventListener("click", (e) => {
  if (!accountDropdown.hidden && !e.target.closest(".account-menu")) {
    accountDropdown.hidden = true;
    accountTrigger.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !accountDropdown.hidden) {
    accountDropdown.hidden = true;
    accountTrigger.setAttribute("aria-expanded", "false");
  }
});

// ================================================================
// Source tabs (URL vs file)
// ================================================================
const srcTabs = $$(".src-tab");
srcTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    srcTabs.forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    state.sourceType = tab.dataset.src;
    $$(".input-card__field").forEach((f) => { f.hidden = f.dataset.field !== state.sourceType; });
    $("#formHint").textContent = "";
  });
});

// ------------------------------------------------------------
// Dropzone
// ------------------------------------------------------------
const dropzone = $("#dropzone");
const fileInput = $("#sourceFile");
const dropzoneLabel = $("#dropzoneLabel");

fileInput.addEventListener("change", () => {
  state.file = fileInput.files[0] || null;
  dropzoneLabel.textContent = state.file ? state.file.name : "Drop a video or audio file, or click to browse";
});
["dragenter", "dragover"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); }));
["dragleave", "drop"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); }));
dropzone.addEventListener("drop", (e) => {
  const dropped = e.dataTransfer.files[0];
  if (dropped) {
    fileInput.files = e.dataTransfer.files;
    state.file = dropped;
    dropzoneLabel.textContent = dropped.name;
  }
});

// ================================================================
// Processing stages
// ================================================================
const STAGES = [
  "Pulling audio from source…",
  "Transcribing speech to text…",
  "Writing the title & summary…",
  "Extracting actions, decisions & questions…",
  "Indexing the transcript for chat…",
];
const stagesList = $("#processingStages");
STAGES.forEach((label, i) => {
  const li = document.createElement("li");
  li.dataset.index = i;
  li.innerHTML = `<span class="stage-icon"></span><span>${label}</span>`;
  stagesList.appendChild(li);
});
makeBars($("#processingWave"), 20);

let stageTimer = null;
function runStageAnimation() {
  const items = $$("#processingStages li");
  const fill = $("#processingFill");
  const title = $("#processingTitle");
  let idx = 0;
  function setActive(i) {
    items.forEach((li, n) => {
      li.classList.toggle("is-done", n < i);
      li.classList.toggle("is-active", n === i);
    });
    if (items[i]) title.textContent = STAGES[i];
    fill.style.width = `${Math.min(96, ((i + 1) / STAGES.length) * 100)}%`;
  }
  setActive(0);
  stageTimer = setInterval(() => {
    if (idx < STAGES.length - 1) { idx += 1; setActive(idx); }
  }, 1400);
}
async function finishStageAnimation() {
  clearInterval(stageTimer);
  const items = $$("#processingStages li");
  for (let i = 0; i < items.length; i++) {
    items[i].classList.remove("is-active");
    items[i].classList.add("is-done");
    await sleep(90);
  }
  $("#processingFill").style.width = "100%";
  await sleep(350);
}

// ================================================================
// Backend calls (auth-protected, with demo-mode fallback)
// ================================================================
async function callAnalyze({ sourceType, url, file, language }) {
  if (state.demo) {
    await sleep(1200);
    return { data: buildDemoResult(sourceType === "file" ? file?.name : url, language), demo: true };
  }
  try {
    let res;
    if (sourceType === "file") {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("language", language);
      res = await authedFetch(`/api/analyze/upload`, { method: "POST", body: fd });
    } else {
      res = await authedFetch(`/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: url, language }),
      });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Backend returned ${res.status}`);
    }
    return { data: await res.json(), demo: false };
  } catch (err) {
    if (err instanceof TypeError) {
      await sleep(1200);
      return { data: buildDemoResult(sourceType === "file" ? file?.name : url, language), demo: true };
    }
    throw err;
  }
}

async function postChat(question) {
  return authedFetch(`/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: state.sessionId, question }),
  });
}

async function callChat(question) {
  if (state.demo) {
    await sleep(700 + Math.random() * 500);
    return demoChatAnswer(question);
  }
  try {
    let res = await postChat(question);

    // Session gone (server restarted) — reopen it from history. Cheap: only
    // rebuilds the vector index, the transcript is already safe in Mongo.
    if (res.status === 404 && state.analysisId) {
      const reopened = await authedFetch(`/api/history/${state.analysisId}`);
      if (reopened.ok) {
        const data = await reopened.json();
        state.sessionId = data.session_id;
        res = await postChat(question);
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Backend returned ${res.status}`);
    }
    const data = await res.json();
    return data.answer;
  } catch (err) {
    if (err instanceof TypeError) {
      await sleep(700 + Math.random() * 500);
      return demoChatAnswer(question);
    }
    throw err;
  }
}

// ================================================================
// Demo data
// ================================================================
function buildDemoResult(sourceLabel, language) {
  return {
    id: "demo",
    title: "Q3 Roadmap Sync — Growth & Platform Teams",
    transcript:
`[00:00] Priya: Thanks for jumping on, let's start with the growth numbers from last sprint.
[00:42] Arjun: Sign-ups are up 12% week over week, mostly from the referral flow we shipped.
[01:15] Priya: Nice. What about the churn on the platform side?
[01:30] Wei: Churn's flat, but support tickets about onboarding are climbing.
[02:04] Arjun: I think that's the file upload step — it's confusing on mobile.
[02:20] Priya: Let's redesign that flow before the next release.
[02:45] Wei: I can have wireframes by Thursday.
[03:10] Priya: Also — do we still support the legacy CSV import?
[03:22] Arjun: Not sure, need to check with the data team.
[03:40] Priya: Okay, open question, let's follow up.
[04:05] Wei: One more thing — should we push the pricing page change to next week?
[04:20] Priya: Yes, let's hold it until onboarding is fixed.`,
    summary:
      "## Summary\n\nThe growth and platform teams reviewed last sprint's metrics: **sign-ups rose 12% week over week** thanks to the referral flow, while platform churn stayed flat but onboarding-related support tickets increased.\n\nThe team traced the friction to a confusing mobile file-upload step and agreed to redesign it before the next release. The pricing page update will be held until onboarding is fixed, and the team still needs to confirm whether legacy CSV import is supported.",
    action_items: [
      "Wei to deliver wireframes for the redesigned onboarding upload flow by Thursday",
      "Arjun to check with the data team on legacy CSV import support",
      "Hold the pricing page change until the onboarding fix ships",
    ],
    key_decisions: [
      "Redesign the mobile file-upload step before the next release",
      "Delay the pricing page change until onboarding issues are resolved",
    ],
    open_questions: [
      "Is legacy CSV import still supported for existing customers?",
      "Should the referral flow be extended to the platform team's users?",
    ],
    meta: { source: sourceLabel || "demo-meeting.mp4", language, cached: false },
  };
}

function demoChatAnswer(question) {
  const q = question.toLowerCase();
  if (q.includes("decision") || q.includes("decide")) {
    return "Two decisions came out of this: redesign the mobile upload step before the next release, and hold the pricing page change until onboarding is fixed.";
  }
  if (q.includes("action") || q.includes("todo") || q.includes("to do")) {
    return "Wei owes wireframes for the onboarding redesign by Thursday, and Arjun is checking with the data team on legacy CSV import.";
  }
  if (q.includes("churn")) {
    return "Churn itself was flat, but onboarding-related support tickets were climbing — that's what triggered the redesign discussion.";
  }
  if (q.includes("sign") || q.includes("growth")) {
    return "Sign-ups were up 12% week over week, driven mostly by the referral flow that shipped last sprint.";
  }
  return "This is demo mode, so I'm answering from the sample transcript — log in with a real backend to chat with your own videos.";
}

// ================================================================
// Form submit → run pipeline
// ================================================================
const form = $("#analyzeForm");
const hint = $("#formHint");
const analyzeBtn = $("#analyzeBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hint.textContent = "";

  const language = $("#language").value;
  const url = $("#sourceUrl").value.trim();

  if (state.sourceType === "url" && !url) {
    hint.textContent = "Paste a YouTube URL to continue.";
    $("#sourceUrl").focus();
    return;
  }
  if (state.sourceType === "file" && !state.file) {
    hint.textContent = "Choose a video or audio file to continue.";
    return;
  }

  analyzeBtn.disabled = true;
  $("#processing").hidden = false;
  $("#results").hidden = true;
  $("#chat-section").hidden = true;
  $("#processing").scrollIntoView({ behavior: "smooth", block: "start" });
  runStageAnimation();

  try {
    const { data, demo } = await callAnalyze({ sourceType: state.sourceType, url, file: state.file, language });
    await finishStageAnimation();
    renderResults(data, demo);
    state.sessionId = data.session_id || null;
    state.analysisId = data.id || null;
    $("#processing").hidden = true;
    $("#results").hidden = false;
    $("#chat-section").hidden = false;
    $("#navChatLink").classList.remove("is-disabled");
    $("#navChatLink").removeAttribute("aria-disabled");
    resetChat();
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    clearInterval(stageTimer);
    $("#processing").hidden = true;
    hint.textContent = `Something went wrong: ${err.message}`;
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
  }
});

// ================================================================
// Render results
// ================================================================
function renderResults(data, demo) {
  state.result = data;

  $("#resultTitle").textContent = data.title || "Untitled";
  $("#resultsEyebrow").textContent = demo ? "Analysis complete · Demo data" : "Analysis complete";

  const meta = $("#resultMeta");
  meta.innerHTML = "";
  const chips = [
    data.meta?.language || "english",
    data.meta?.created_at ? fmtDate(data.meta.created_at) : null,
    demo ? "Demo mode" : data.meta?.cached ? "From cache" : "Live",
  ].filter(Boolean);
  chips.forEach((c) => {
    const span = document.createElement("span");
    span.textContent = c;
    meta.appendChild(span);
  });

  $("#summaryContent").innerHTML = renderMarkdown(data.summary || "", false);
  fillList("#actionsContent", normalizeList(data.action_items), checkIcon());
  fillList("#decisionsContent", normalizeList(data.key_decisions), decisionIcon());
  fillList("#questionsContent", normalizeList(data.open_questions), questionIcon());
  $("#transcriptContent").textContent = data.transcript || "No transcript returned.";
}

function renderMarkdown(text, inline = false) {
  if (window.marked) {
    try {
      const raw = inline ? marked.parseInline(text) : marked.parse(text, { breaks: true });
      return window.DOMPurify ? DOMPurify.sanitize(raw) : raw;
    } catch (err) {
      console.warn("Wavelength: markdown parse failed, falling back to plain text", err);
    }
  }
  return inline ? escapeHtml(text) : formatSummaryFallback(text);
}

function formatSummaryFallback(text) {
  if (!text || !text.trim()) return `<p class="empty-note">No summary returned.</p>`;
  let paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) paragraphs = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) {
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
    const grouped = [];
    for (let i = 0; i < sentences.length; i += 3) grouped.push(sentences.slice(i, i + 3).join(" ").trim());
    paragraphs = grouped.filter(Boolean);
  }
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

function fillList(selector, items, iconSvg) {
  const el = $(selector);
  el.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="empty-note">Nothing surfaced here for this video.</span>`;
    el.appendChild(li);
    return;
  }
  items.forEach((text) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="icon">${iconSvg}</span><span>${renderMarkdown(text, true)}</span>`;
    el.appendChild(li);
  });
}

const checkIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.3 6.3a1 1 0 0 1 0 1.4l-9.6 9.6a1 1 0 0 1-1.4 0L4.7 12.7a1 1 0 1 1 1.4-1.4l3.9 3.9 8.9-8.9a1 1 0 0 1 1.4 0Z"/></svg>`;
const decisionIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2 2 7l10 5 10-5-10-5Zm0 8.5L4 6.7v3.4l8 4.9 8-4.9V6.7l-8 3.8ZM4 12.7v3.4l8 4.9 8-4.9v-3.4l-8 4.9-8-4.9Z"/></svg>`;
const questionIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.9 15.5h-1.8v-1.8h1.8v1.8Zm1.86-6.9c-.45.66-.9 1-1.26 1.36-.4.4-.6.73-.6 1.36h-1.8c0-1 .3-1.53.85-2.08.4-.4.9-.75 1.16-1.15.24-.36.34-.7.34-1.1 0-.9-.68-1.5-1.6-1.5-.86 0-1.5.5-1.66 1.36l-1.78-.24C8.7 7.1 9.98 6 11.9 6c1.98 0 3.4 1.2 3.4 3 0 .8-.24 1.4-.54 1.6Z"/></svg>`;

// ================================================================
// Tabs
// ================================================================
const tabs = $$(".tab");
const indicator = $("#tabIndicator");
function positionIndicator(tab) {
  indicator.style.width = `${tab.offsetWidth}px`;
  indicator.style.left = `${tab.offsetLeft}px`;
}
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    $$(".panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab));
    positionIndicator(tab);
  });
});
window.addEventListener("resize", () => { const a = $(".tab.is-active"); if (a) positionIndicator(a); });

// ================================================================
// Chat
// ================================================================
const chatMessages = $("#chatMessages");
const chatForm = $("#chatForm");
const chatInput = $("#chatInput");
const chatSend = $("#chatSend");

function resetChat() {
  chatMessages.innerHTML = "";
  addMessage("bot", "I've read the whole transcript — ask me about decisions, action items, or anything that came up.");
}
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg msg--${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}
function addTyping() {
  const div = document.createElement("div");
  div.className = "msg msg--bot msg--typing";
  const wave = document.createElement("div");
  wave.className = "waveform waveform--tiny";
  div.appendChild(wave);
  chatMessages.appendChild(div);
  makeBars(wave, 4);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = chatInput.value.trim();
  if (!q) return;
  addMessage("user", q);
  chatInput.value = "";
  chatSend.disabled = true;
  const typing = addTyping();
  try {
    const answer = await callChat(q);
    typing.remove();
    addMessage("bot", answer);
  } catch (err) {
    typing.remove();
    addMessage("bot", `Couldn't reach the assistant: ${err.message}`);
  } finally {
    chatSend.disabled = false;
    chatInput.focus();
  }
});

// ================================================================
// History panel
// ================================================================
const historyPanel = $("#historyPanel");
const historyList = $("#historyList");

function openHistoryPanel() {
  historyPanel.hidden = false;
  loadHistoryList();
}
function closeHistoryPanel() {
  historyPanel.hidden = true;
}
$("#historyBtn").addEventListener("click", openHistoryPanel);
$("#historyClose").addEventListener("click", closeHistoryPanel);
$("#historyBackdrop").addEventListener("click", closeHistoryPanel);

async function loadHistoryList() {
  historyList.innerHTML = `<li class="history-panel__empty">Loading…</li>`;
  try {
    const res = await authedFetch(`/api/history`);
    if (!res.ok) throw new Error("Couldn't load history.");
    const { items } = await res.json();
    if (!items.length) {
      historyList.innerHTML = `<li class="history-panel__empty">No analyses yet — run one and it'll show up here.</li>`;
      return;
    }
    historyList.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <div>
          <div class="history-item__title">${escapeHtml(item.title)}</div>
          <div class="history-item__meta">
            <span>${escapeHtml(item.language)}</span><span>·</span><span>${fmtDate(item.created_at)}</span>
          </div>
        </div>
        <button class="history-item__delete" title="Delete" aria-label="Delete this analysis">&times;</button>
      `;
      li.querySelector("div").addEventListener("click", () => loadHistoryItem(item.id));
      li.querySelector(".history-item__delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        await authedFetch(`/api/history/${item.id}`, { method: "DELETE" });
        loadHistoryList();
      });
      historyList.appendChild(li);
    });
  } catch (err) {
    historyList.innerHTML = `<li class="history-panel__empty">${escapeHtml(err.message)}</li>`;
  }
}

async function loadHistoryItem(id) {
  try {
    const res = await authedFetch(`/api/history/${id}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Couldn't open that analysis.");
    }
    const data = await res.json();
    renderResults(data, false);
    state.sessionId = data.session_id;
    state.analysisId = data.id;
    $("#results").hidden = false;
    $("#chat-section").hidden = false;
    $("#navChatLink").classList.remove("is-disabled");
    $("#navChatLink").removeAttribute("aria-disabled");
    resetChat();
    closeHistoryPanel();
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    historyList.insertAdjacentHTML(
      "afterbegin",
      `<li class="history-panel__empty" style="color:var(--rose)">${escapeHtml(err.message)}</li>`
    );
  }
}

// --- clear all history (two-click confirm, no jarring native dialog) ---
const historyClearBtn = $("#historyClearAll");
let clearConfirmTimer = null;

historyClearBtn.addEventListener("click", async () => {
  if (!historyClearBtn.classList.contains("is-confirming")) {
    historyClearBtn.classList.add("is-confirming");
    historyClearBtn.textContent = "Click again to confirm";
    clearConfirmTimer = setTimeout(() => {
      historyClearBtn.classList.remove("is-confirming");
      historyClearBtn.textContent = "Clear all history";
    }, 3000);
    return;
  }

  clearTimeout(clearConfirmTimer);
  historyClearBtn.disabled = true;
  try {
    await authedFetch(`/api/history`, { method: "DELETE" });
    await loadHistoryList();
  } catch (err) {
    console.error(err);
  } finally {
    historyClearBtn.disabled = false;
    historyClearBtn.classList.remove("is-confirming");
    historyClearBtn.textContent = "Clear all history";
  }
});

// ================================================================
// Scroll reveal for "how it works" cards
// ================================================================
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.style.animationDelay = `${i * 0.08}s`;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);
$$(".how__card").forEach((card) => observer.observe(card));

// Chrome keeps `animation: ... both` elements on their own GPU layer even
// after the animation finishes. If a layout change happens anywhere inside
// them later (like the name field's height animating), Chrome re-rasterizes
// that whole layer and briefly blurs the text. Releasing the animation once
// it's done fixes it for good instead of just moving the symptom around.
// Delegated on document (not queried once at load) because .oauth-btn
// elements don't exist yet at this point — they render async after
// /api/auth/providers resolves.
document.addEventListener("animationend", (e) => {
  if (e.target.matches?.(".auth-card, .auth-field, .oauth-btn")) {
    e.target.style.animation = "none";
  }
});

// ================================================================
// Go
// ================================================================
bootstrap();