// const API_BASE = "http://localhost:8000";

// const STORAGE_KEY = "wavelength:last-analysis";

// const state = {
//   sourceType: "url",
//   file: null,
//   sessionId: null,
//   result: null,
//   // Only URL sources can be silently re-analyzed to recover a dead session —
//   // uploaded File objects don't survive a page reload, so those can't.
//   recoverableSource: null,
//   language: "english",
// };

// // ------------------------------------------------------------
// // Utilities
// // ------------------------------------------------------------
// const $ = (sel, root = document) => root.querySelector(sel);
// const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
// const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// function makeBars(container, count) {
//   container.innerHTML = "";
//   const frag = document.createDocumentFragment();
//   for (let i = 0; i < count; i++) {
//     const bar = document.createElement("span");
//     bar.className = "bar";
//     const dur = (0.7 + Math.random() * 0.9).toFixed(2);
//     const delay = (Math.random() * 1).toFixed(2);
//     bar.style.animationDuration = `${dur}s`;
//     bar.style.animationDelay = `${delay}s`;
//     frag.appendChild(bar);
//   }
//   container.appendChild(frag);
// }

// // Turn a string OR array (extractor functions may return either) into a clean list.
// function normalizeList(value) {
//   if (Array.isArray(value)) {
//     return value.map((v) => String(v).replace(/^[-*\u2022\d.)\s]+/, "").trim()).filter(Boolean);
//   }
//   if (typeof value === "string") {
//     return value
//       .split(/\r?\n/)
//       .map((line) => line.replace(/^[-*\u2022\d.)\s]+/, "").trim())
//       .filter(Boolean);
//   }
//   return [];
// }

// function escapeHtml(str) {
//   const div = document.createElement("div");
//   div.textContent = str;
//   return div.innerHTML;
// }

// // ------------------------------------------------------------
// // Ambient hero waveform
// // ------------------------------------------------------------
// makeBars($("#ambientWave"), 28);

// // ------------------------------------------------------------
// // Source tabs (URL vs file)
// // ------------------------------------------------------------
// const srcTabs = $$(".src-tab");
// srcTabs.forEach((tab) => {
//   tab.addEventListener("click", () => {
//     srcTabs.forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
//     tab.classList.add("is-active");
//     tab.setAttribute("aria-selected", "true");
//     state.sourceType = tab.dataset.src;
//     $$(".input-card__field").forEach((f) => { f.hidden = f.dataset.field !== state.sourceType; });
//     $("#formHint").textContent = "";
//   });
// });

// // ------------------------------------------------------------
// // Dropzone
// // ------------------------------------------------------------
// const dropzone = $("#dropzone");
// const fileInput = $("#sourceFile");
// const dropzoneLabel = $("#dropzoneLabel");

// fileInput.addEventListener("change", () => {
//   state.file = fileInput.files[0] || null;
//   dropzoneLabel.textContent = state.file ? state.file.name : "Drop a video or audio file, or click to browse";
// });

// ["dragenter", "dragover"].forEach((evt) => {
//   dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); });
// });
// ["dragleave", "drop"].forEach((evt) => {
//   dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); });
// });
// dropzone.addEventListener("drop", (e) => {
//   const dropped = e.dataTransfer.files[0];
//   if (dropped) {
//     fileInput.files = e.dataTransfer.files;
//     state.file = dropped;
//     dropzoneLabel.textContent = dropped.name;
//   }
// });

// // ------------------------------------------------------------
// // Processing stages
// // ------------------------------------------------------------
// const STAGES = [
//   "Pulling audio from source…",
//   "Transcribing speech to text…",
//   "Writing the title & summary…",
//   "Extracting actions, decisions & questions…",
//   "Indexing the transcript for chat…",
// ];

// const stagesList = $("#processingStages");
// STAGES.forEach((label, i) => {
//   const li = document.createElement("li");
//   li.dataset.index = i;
//   li.innerHTML = `<span class="stage-icon"></span><span>${label}</span>`;
//   stagesList.appendChild(li);
// });
// makeBars($("#processingWave"), 20);

// let stageTimer = null;
// function runStageAnimation() {
//   const items = $$("#processingStages li");
//   const fill = $("#processingFill");
//   const title = $("#processingTitle");
//   let idx = 0;

//   function setActive(i) {
//     items.forEach((li, n) => {
//       li.classList.toggle("is-done", n < i);
//       li.classList.toggle("is-active", n === i);
//     });
//     if (items[i]) title.textContent = STAGES[i];
//     fill.style.width = `${Math.min(96, ((i + 1) / STAGES.length) * 100)}%`;
//   }

//   setActive(0);
//   stageTimer = setInterval(() => {
//     // Advance, but hold on the last stage until the real request resolves.
//     if (idx < STAGES.length - 1) {
//       idx += 1;
//       setActive(idx);
//     }
//   }, 1400);
// }

// async function finishStageAnimation() {
//   clearInterval(stageTimer);
//   const items = $$("#processingStages li");
//   for (let i = 0; i < items.length; i++) {
//     items[i].classList.remove("is-active");
//     items[i].classList.add("is-done");
//     await sleep(90);
//   }
//   $("#processingFill").style.width = "100%";
//   await sleep(350);
// }

// // ------------------------------------------------------------
// // Backend calls (with graceful demo-mode fallback)
// // ------------------------------------------------------------
// async function callAnalyze({ sourceType, url, file, language }) {
//   try {
//     let res;
//     if (sourceType === "file") {
//       const fd = new FormData();
//       fd.append("file", file);
//       fd.append("language", language);
//       res = await fetch(`${API_BASE}/api/analyze/upload`, { method: "POST", body: fd });
//     } else {
//       res = await fetch(`${API_BASE}/api/analyze`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ source: url, language }),
//       });
//     }
//     if (!res.ok) {
//       const detail = await res.text().catch(() => "");
//       throw new Error(`Backend returned ${res.status}${detail ? `: ${detail}` : ""}`);
//     }
//     const data = await res.json();
//     return { data, demo: false };
//   } catch (err) {
//     if (err instanceof TypeError) {
//       // Network-level failure = api_server.py isn't running. Fall back to demo data.
//       console.warn("Wavelength: backend unreachable, showing demo data. Start api_server.py to go live.");
//       await sleep(1200);
//       return { data: buildDemoResult(sourceType === "file" ? file?.name : url, language), demo: true };
//     }
//     throw err;
//   }
// }

// async function postChat(question) {
//   return fetch(`${API_BASE}/api/chat`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ session_id: state.sessionId, question }),
//   });
// }

// async function callChat(question) {
//   try {
//     let res = await postChat(question);

//     // Session gone (server restarted since we got it) — if this was a URL
//     // source, silently re-analyze (near-instant thanks to the backend cache)
//     // and retry once with the fresh session_id.
//     if (res.status === 404 && state.recoverableSource) {
//       const { data, demo } = await callAnalyze({ sourceType: "url", ...state.recoverableSource });
//       if (!demo) {
//         state.sessionId = data.session_id;
//         persistState(demo);
//         res = await postChat(question);
//       }
//     }

//     if (res.status === 404) {
//       return "This chat session isn't available anymore (the backend likely restarted) and I can't silently recover it — uploaded files don't survive a reload, so please re-run Analyze on this file.";
//     }
//     if (!res.ok) throw new Error(`Backend returned ${res.status}`);
//     const data = await res.json();
//     return data.answer;
//   } catch (err) {
//     if (err instanceof TypeError) {
//       await sleep(700 + Math.random() * 500);
//       return demoChatAnswer(question);
//     }
//     throw err;
//   }
// }

// // ------------------------------------------------------------
// // Demo data (used only when api_server.py isn't running)
// // ------------------------------------------------------------
// function buildDemoResult(sourceLabel, language) {
//   return {
//     title: "Q3 Roadmap Sync — Growth & Platform Teams",
//     transcript:
// `[00:00] Priya: Thanks for jumping on, let's start with the growth numbers from last sprint.
// [00:42] Arjun: Sign-ups are up 12% week over week, mostly from the referral flow we shipped.
// [01:15] Priya: Nice. What about the churn on the platform side?
// [01:30] Wei: Churn's flat, but support tickets about onboarding are climbing.
// [02:04] Arjun: I think that's the file upload step — it's confusing on mobile.
// [02:20] Priya: Let's redesign that flow before the next release.
// [02:45] Wei: I can have wireframes by Thursday.
// [03:10] Priya: Also — do we still support the legacy CSV import?
// [03:22] Arjun: Not sure, need to check with the data team.
// [03:40] Priya: Okay, open question, let's follow up.
// [04:05] Wei: One more thing — should we push the pricing page change to next week?
// [04:20] Priya: Yes, let's hold it until onboarding is fixed.`,
//     summary:
//       "The growth and platform teams reviewed last sprint's metrics: sign-ups rose 12% week over week thanks to the referral flow, while platform churn stayed flat but onboarding-related support tickets increased. The team traced the friction to a confusing mobile file-upload step and agreed to redesign it before the next release. The pricing page update will be held until onboarding is fixed, and the team still needs to confirm whether legacy CSV import is supported.",
//     action_items: [
//       "Wei to deliver wireframes for the redesigned onboarding upload flow by Thursday",
//       "Arjun to check with the data team on legacy CSV import support",
//       "Hold the pricing page change until the onboarding fix ships",
//     ],
//     key_decisions: [
//       "Redesign the mobile file-upload step before the next release",
//       "Delay the pricing page change until onboarding issues are resolved",
//     ],
//     open_questions: [
//       "Is legacy CSV import still supported for existing customers?",
//       "Should the referral flow be extended to the platform team's users?",
//     ],
//     meta: {
//       source: sourceLabel || "demo-meeting.mp4",
//       language,
//       duration: "4:32",
//     },
//   };
// }

// function demoChatAnswer(question) {
//   const q = question.toLowerCase();
//   if (q.includes("decision") || q.includes("decide")) {
//     return "Two decisions came out of this: redesign the mobile upload step before the next release, and hold the pricing page change until onboarding is fixed.";
//   }
//   if (q.includes("action") || q.includes("todo") || q.includes("to do")) {
//     return "Wei owes wireframes for the onboarding redesign by Thursday, and Arjun is checking with the data team on legacy CSV import.";
//   }
//   if (q.includes("churn")) {
//     return "Churn itself was flat, but onboarding-related support tickets were climbing — that's what triggered the redesign discussion.";
//   }
//   if (q.includes("sign") || q.includes("growth")) {
//     return "Sign-ups were up 12% week over week, driven mostly by the referral flow that shipped last sprint.";
//   }
//   return "This is demo mode, so I'm answering from the sample transcript — start api_server.py and point API_BASE at it to chat with your real video.";
// }

// // ------------------------------------------------------------
// // Form submit → run pipeline
// // ------------------------------------------------------------
// const form = $("#analyzeForm");
// const hint = $("#formHint");
// const analyzeBtn = $("#analyzeBtn");

// form.addEventListener("submit", async (e) => {
//   e.preventDefault();
//   hint.textContent = "";

//   const language = $("#language").value;
//   const url = $("#sourceUrl").value.trim();

//   if (state.sourceType === "url" && !url) {
//     hint.textContent = "Paste a YouTube URL to continue.";
//     $("#sourceUrl").focus();
//     return;
//   }
//   if (state.sourceType === "file" && !state.file) {
//     hint.textContent = "Choose a video or audio file to continue.";
//     return;
//   }

//   analyzeBtn.disabled = true;
//   $("#processing").hidden = false;
//   $("#results").hidden = true;
//   $("#chat-section").hidden = true;
//   $("#processing").scrollIntoView({ behavior: "smooth", block: "start" });
//   runStageAnimation();

//   try {
//     const { data, demo } = await callAnalyze({
//       sourceType: state.sourceType,
//       url,
//       file: state.file,
//       language,
//     });
//     await finishStageAnimation();
//     renderResults(data, demo);
//     state.sessionId = data.session_id || null;
//     state.language = language;
//     state.recoverableSource = state.sourceType === "url" ? { sourceType: "url", url, language } : null;
//     $("#processing").hidden = true;
//     $("#results").hidden = false;
//     $("#chat-section").hidden = false;
//     $("#navChatLink").classList.remove("is-disabled");
//     $("#navChatLink").removeAttribute("aria-disabled");
//     resetChat();
//     persistState(demo);
//     $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
//   } catch (err) {
//     clearInterval(stageTimer);
//     $("#processing").hidden = true;
//     hint.textContent = `Something went wrong: ${err.message}`;
//     console.error(err);
//   } finally {
//     analyzeBtn.disabled = false;
//   }
// });

// // ------------------------------------------------------------
// // Render results
// // ------------------------------------------------------------
// function renderResults(data, demo) {
//   state.result = data;

//   $("#resultTitle").textContent = data.title || "Untitled";
//   $("#resultsEyebrow").textContent = demo ? "Analysis complete · Demo data" : "Analysis complete";

//   const meta = $("#resultMeta");
//   meta.innerHTML = "";
//   const chips = [
//     data.meta?.language || "english",
//     data.meta?.duration ? `${data.meta.duration}` : null,
//     demo ? "Demo mode" : "Live",
//   ].filter(Boolean);
//   chips.forEach((c) => {
//     const span = document.createElement("span");
//     span.textContent = c;
//     meta.appendChild(span);
//   });

//   $("#summaryContent").innerHTML = renderMarkdown(data.summary || "", false);

//   fillList("#actionsContent", normalizeList(data.action_items), checkIcon());
//   fillList("#decisionsContent", normalizeList(data.key_decisions), decisionIcon());
//   fillList("#questionsContent", normalizeList(data.open_questions), questionIcon());

//   $("#transcriptContent").textContent = data.transcript || "No transcript returned.";
// }

// // Render markdown (LLM output is often markdown-formatted: #, **, -, etc.)
// // safely to HTML. Falls back to plain-paragraph splitting if the CDN
// // libraries didn't load (e.g. offline).
// function renderMarkdown(text, inline = false) {
//   if (window.marked) {
//     try {
//       const raw = inline ? marked.parseInline(text) : marked.parse(text, { breaks: true });
//       return window.DOMPurify ? DOMPurify.sanitize(raw) : raw;
//     } catch (err) {
//       console.warn("Wavelength: markdown parse failed, falling back to plain text", err);
//     }
//   }
//   return inline ? escapeHtml(text) : formatSummaryFallback(text);
// }

// // Last-resort formatter if marked.js isn't available: group a wall of text
// // into readable paragraphs instead of showing it as one block.
// function formatSummaryFallback(text) {
//   if (!text || !text.trim()) return `<p class="empty-note">No summary returned.</p>`;
//   let paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
//   if (paragraphs.length <= 1) paragraphs = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
//   if (paragraphs.length <= 1) {
//     const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
//     const grouped = [];
//     for (let i = 0; i < sentences.length; i += 3) grouped.push(sentences.slice(i, i + 3).join(" ").trim());
//     paragraphs = grouped.filter(Boolean);
//   }
//   return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
// }

// function fillList(selector, items, iconSvg) {
//   const el = $(selector);
//   el.innerHTML = "";
//   if (!items.length) {
//     const li = document.createElement("li");
//     li.innerHTML = `<span class="empty-note">Nothing surfaced here for this video.</span>`;
//     el.appendChild(li);
//     return;
//   }
//   items.forEach((text) => {
//     const li = document.createElement("li");
//     li.innerHTML = `<span class="icon">${iconSvg}</span><span>${renderMarkdown(text, true)}</span>`;
//     el.appendChild(li);
//   });
// }

// const checkIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.3 6.3a1 1 0 0 1 0 1.4l-9.6 9.6a1 1 0 0 1-1.4 0L4.7 12.7a1 1 0 1 1 1.4-1.4l3.9 3.9 8.9-8.9a1 1 0 0 1 1.4 0Z"/></svg>`;
// const decisionIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2 2 7l10 5 10-5-10-5Zm0 8.5L4 6.7v3.4l8 4.9 8-4.9V6.7l-8 3.8ZM4 12.7v3.4l8 4.9 8-4.9v-3.4l-8 4.9-8-4.9Z"/></svg>`;
// const questionIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.9 15.5h-1.8v-1.8h1.8v1.8Zm1.86-6.9c-.45.66-.9 1-1.26 1.36-.4.4-.6.73-.6 1.36h-1.8c0-1 .3-1.53.85-2.08.4-.4.9-.75 1.16-1.15.24-.36.34-.7.34-1.1 0-.9-.68-1.5-1.6-1.5-.86 0-1.5.5-1.66 1.36l-1.78-.24C8.7 7.1 9.98 6 11.9 6c1.98 0 3.4 1.2 3.4 3 0 .8-.24 1.4-.54 1.6Z"/></svg>`;

// // ------------------------------------------------------------
// // Tabs
// // ------------------------------------------------------------
// const tabs = $$(".tab");
// const indicator = $("#tabIndicator");

// function positionIndicator(tab) {
//   indicator.style.width = `${tab.offsetWidth}px`;
//   indicator.style.left = `${tab.offsetLeft}px`;
// }

// tabs.forEach((tab) => {
//   tab.addEventListener("click", () => {
//     tabs.forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
//     tab.classList.add("is-active");
//     tab.setAttribute("aria-selected", "true");
//     $$(".panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab));
//     positionIndicator(tab);
//   });
// });
// window.addEventListener("resize", () => {
//   const active = $(".tab.is-active");
//   if (active) positionIndicator(active);
// });
// window.addEventListener("load", () => {
//   const active = $(".tab.is-active");
//   if (active) positionIndicator(active);
// });

// // ------------------------------------------------------------
// // Chat
// // ------------------------------------------------------------
// const chatMessages = $("#chatMessages");
// const chatForm = $("#chatForm");
// const chatInput = $("#chatInput");
// const chatSend = $("#chatSend");

// function resetChat() {
//   chatMessages.innerHTML = "";
//   addMessage("bot", "I've read the whole transcript — ask me about decisions, action items, or anything that came up.");
// }

// function addMessage(role, text) {
//   const div = document.createElement("div");
//   div.className = `msg msg--${role}`;
//   div.textContent = text;
//   chatMessages.appendChild(div);
//   chatMessages.scrollTop = chatMessages.scrollHeight;
//   return div;
// }

// function addTyping() {
//   const div = document.createElement("div");
//   div.className = "msg msg--bot msg--typing";
//   const wave = document.createElement("div");
//   wave.className = "waveform waveform--tiny";
//   div.appendChild(wave);
//   chatMessages.appendChild(div);
//   makeBars(wave, 4);
//   chatMessages.scrollTop = chatMessages.scrollHeight;
//   return div;
// }

// chatForm.addEventListener("submit", async (e) => {
//   e.preventDefault();
//   const q = chatInput.value.trim();
//   if (!q) return;
//   addMessage("user", q);
//   chatInput.value = "";
//   chatSend.disabled = true;

//   const typing = addTyping();
//   try {
//     const answer = await callChat(q);
//     typing.remove();
//     addMessage("bot", answer);
//   } catch (err) {
//     typing.remove();
//     addMessage("bot", `Couldn't reach the assistant: ${err.message}`);
//   } finally {
//     chatSend.disabled = false;
//     chatInput.focus();
//   }
// });

// // ------------------------------------------------------------
// // Persist results across reloads (localStorage — this is a real page
// // served to your own browser, not a sandboxed artifact, so it's fine here).
// // ------------------------------------------------------------
// function persistState(demo) {
//   try {
//     localStorage.setItem(
//       STORAGE_KEY,
//       JSON.stringify({
//         result: state.result,
//         sessionId: state.sessionId,
//         recoverableSource: state.recoverableSource,
//         demo,
//         savedAt: Date.now(),
//       })
//     );
//   } catch (err) {
//     console.warn("Wavelength: couldn't persist state to localStorage", err);
//   }
// }

// function restoreState() {
//   let saved;
//   try {
//     const raw = localStorage.getItem(STORAGE_KEY);
//     if (!raw) return;
//     saved = JSON.parse(raw);
//   } catch {
//     return;
//   }
//   if (!saved?.result) return;

//   state.result = saved.result;
//   state.sessionId = saved.sessionId || null;
//   state.recoverableSource = saved.recoverableSource || null;

//   if (state.recoverableSource?.url) {
//     $("#sourceUrl").value = state.recoverableSource.url;
//     $("#language").value = state.recoverableSource.language || "english";
//   }

//   renderResults(saved.result, !!saved.demo);
//   $("#results").hidden = false;
//   $("#chat-section").hidden = false;
//   $("#navChatLink").classList.remove("is-disabled");
//   $("#navChatLink").removeAttribute("aria-disabled");
//   chatMessages.innerHTML = "";
//   addMessage(
//     "bot",
//     saved.recoverableSource
//       ? "Welcome back — restored your last results. If the backend restarted meanwhile, your first question here will silently re-analyze this URL to reconnect."
//       : "Welcome back — restored your last results from this browser."
//   );
// }

// // ------------------------------------------------------------
// // Scroll reveal for "how it works" cards
// // ------------------------------------------------------------
// const observer = new IntersectionObserver(
//   (entries) => {
//     entries.forEach((entry, i) => {
//       if (entry.isIntersecting) {
//         entry.target.style.animationDelay = `${i * 0.08}s`;
//         entry.target.classList.add("is-visible");
//         observer.unobserve(entry.target);
//       }
//     });
//   },
//   { threshold: 0.15 }
// );
// $$(".how__card").forEach((card) => observer.observe(card));

// // ------------------------------------------------------------
// // Restore last session, if any, once everything above is wired up.
// // ------------------------------------------------------------
// restoreState();
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
  showAuthGate(message);
}

function toggleNavAuthUi(loggedIn) {
  $("#historyBtn").hidden = !loggedIn;
  $("#navEmail").hidden = !loggedIn;
  $("#logoutBtn").hidden = !loggedIn;
}

function showAuthGate(message) {
  $("#authOverlay").hidden = false;
  $("#authHint").textContent = message || "";
}

function enterApp({ demo }) {
  state.demo = demo;
  $("#authOverlay").hidden = true;
  $("#top").hidden = false;
  toggleNavAuthUi(!demo);
  if (!demo && state.user) {
    $("#navEmail").textContent = state.user.email;
    $("#navEmail").hidden = false;
  }
}

async function bootstrap() {
  if (state.token) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        state.user = data.user;
        enterApp({ demo: false });
        return;
      }
      setToken(null); // expired/invalid
    } catch (err) {
      if (err instanceof TypeError) {
        enterApp({ demo: true }); // backend unreachable — go straight to demo mode
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
      enterApp({ demo: true });
      return;
    }
  }
  showAuthGate();
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
    $("#authHint").textContent = "";
  });
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const hint = $("#authHint");
  const submitBtn = $("#authSubmit");
  hint.textContent = "";

  if (password.length < 8) {
    hint.textContent = "Password must be at least 8 characters.";
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
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
    if (!res.ok) throw new Error("Couldn't open that analysis.");
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
  }
}

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

// ================================================================
// Go
// ================================================================
bootstrap();