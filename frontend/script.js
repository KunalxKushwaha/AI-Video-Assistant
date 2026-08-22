// ============================================================
// WAVELENGTH — front-end logic
// Wire this up to your own FastAPI/Flask wrapper around main.py.
// See api_server.py + README.md for a ready-made backend.
// ============================================================

// Point this at wherever you run api_server.py. If it's unreachable,
// the UI automatically falls back to demo data so it's still explorable.
const API_BASE = "http://localhost:8000";

const state = {
  sourceType: "url",
  file: null,
  sessionId: null,
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
    const dur = (0.7 + Math.random() * 0.9).toFixed(2);
    const delay = (Math.random() * 1).toFixed(2);
    bar.style.animationDuration = `${dur}s`;
    bar.style.animationDelay = `${delay}s`;
    frag.appendChild(bar);
  }
  container.appendChild(frag);
}

// Turn a string OR array (extractor functions may return either) into a clean list.
function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).replace(/^[-*\u2022\d.)\s]+/, "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\u2022\d.)\s]+/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ------------------------------------------------------------
// Ambient hero waveform
// ------------------------------------------------------------
makeBars($("#ambientWave"), 28);

// ------------------------------------------------------------
// Source tabs (URL vs file)
// ------------------------------------------------------------
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

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); });
});
dropzone.addEventListener("drop", (e) => {
  const dropped = e.dataTransfer.files[0];
  if (dropped) {
    fileInput.files = e.dataTransfer.files;
    state.file = dropped;
    dropzoneLabel.textContent = dropped.name;
  }
});

// ------------------------------------------------------------
// Processing stages
// ------------------------------------------------------------
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
    // Advance, but hold on the last stage until the real request resolves.
    if (idx < STAGES.length - 1) {
      idx += 1;
      setActive(idx);
    }
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

// ------------------------------------------------------------
// Backend calls (with graceful demo-mode fallback)
// ------------------------------------------------------------
async function callAnalyze({ sourceType, url, file, language }) {
  try {
    let res;
    if (sourceType === "file") {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("language", language);
      res = await fetch(`${API_BASE}/api/analyze/upload`, { method: "POST", body: fd });
    } else {
      res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: url, language }),
      });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Backend returned ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await res.json();
    return { data, demo: false };
  } catch (err) {
    if (err instanceof TypeError) {
      // Network-level failure = api_server.py isn't running. Fall back to demo data.
      console.warn("Wavelength: backend unreachable, showing demo data. Start api_server.py to go live.");
      await sleep(1200);
      return { data: buildDemoResult(sourceType === "file" ? file?.name : url, language), demo: true };
    }
    throw err;
  }
}

async function callChat(question) {
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, question }),
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
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

// ------------------------------------------------------------
// Demo data (used only when api_server.py isn't running)
// ------------------------------------------------------------
function buildDemoResult(sourceLabel, language) {
  return {
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
      "The growth and platform teams reviewed last sprint's metrics: sign-ups rose 12% week over week thanks to the referral flow, while platform churn stayed flat but onboarding-related support tickets increased. The team traced the friction to a confusing mobile file-upload step and agreed to redesign it before the next release. The pricing page update will be held until onboarding is fixed, and the team still needs to confirm whether legacy CSV import is supported.",
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
    meta: {
      source: sourceLabel || "demo-meeting.mp4",
      language,
      duration: "4:32",
    },
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
  return "This is demo mode, so I'm answering from the sample transcript — start api_server.py and point API_BASE at it to chat with your real video.";
}

// ------------------------------------------------------------
// Form submit → run pipeline
// ------------------------------------------------------------
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
    const { data, demo } = await callAnalyze({
      sourceType: state.sourceType,
      url,
      file: state.file,
      language,
    });
    await finishStageAnimation();
    renderResults(data, demo);
    state.sessionId = data.session_id || null;
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

// ------------------------------------------------------------
// Render results
// ------------------------------------------------------------
function renderResults(data, demo) {
  state.result = data;

  $("#resultTitle").textContent = data.title || "Untitled";
  $("#resultsEyebrow").textContent = demo ? "Analysis complete · Demo data" : "Analysis complete";

  const meta = $("#resultMeta");
  meta.innerHTML = "";
  const chips = [
    data.meta?.language || "english",
    data.meta?.duration ? `${data.meta.duration}` : null,
    demo ? "Demo mode" : "Live",
  ].filter(Boolean);
  chips.forEach((c) => {
    const span = document.createElement("span");
    span.textContent = c;
    meta.appendChild(span);
  });

  $("#summaryContent").innerHTML = formatSummary(data.summary);

  fillList("#actionsContent", normalizeList(data.action_items), checkIcon());
  fillList("#decisionsContent", normalizeList(data.key_decisions), decisionIcon());
  fillList("#questionsContent", normalizeList(data.open_questions), questionIcon());

  $("#transcriptContent").textContent = data.transcript || "No transcript returned.";
}

// Turn a summary string into readable paragraphs. LLM output is often one
// giant blob with no line breaks at all, so as a last resort we group
// sentences into short paragraphs ourselves rather than showing a wall of text.
function formatSummary(text) {
  if (!text || !text.trim()) return `<p class="empty-note">No summary returned.</p>`;

  let paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (paragraphs.length <= 1) {
    paragraphs = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  }

  if (paragraphs.length <= 1) {
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
    const grouped = [];
    for (let i = 0; i < sentences.length; i += 3) {
      grouped.push(sentences.slice(i, i + 3).join(" ").trim());
    }
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
    li.innerHTML = `<span class="icon">${iconSvg}</span><span>${escapeHtml(text)}</span>`;
    el.appendChild(li);
  });
}

const checkIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.3 6.3a1 1 0 0 1 0 1.4l-9.6 9.6a1 1 0 0 1-1.4 0L4.7 12.7a1 1 0 1 1 1.4-1.4l3.9 3.9 8.9-8.9a1 1 0 0 1 1.4 0Z"/></svg>`;
const decisionIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2 2 7l10 5 10-5-10-5Zm0 8.5L4 6.7v3.4l8 4.9 8-4.9V6.7l-8 3.8ZM4 12.7v3.4l8 4.9 8-4.9v-3.4l-8 4.9-8-4.9Z"/></svg>`;
const questionIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.9 15.5h-1.8v-1.8h1.8v1.8Zm1.86-6.9c-.45.66-.9 1-1.26 1.36-.4.4-.6.73-.6 1.36h-1.8c0-1 .3-1.53.85-2.08.4-.4.9-.75 1.16-1.15.24-.36.34-.7.34-1.1 0-.9-.68-1.5-1.6-1.5-.86 0-1.5.5-1.66 1.36l-1.78-.24C8.7 7.1 9.98 6 11.9 6c1.98 0 3.4 1.2 3.4 3 0 .8-.24 1.4-.54 1.6Z"/></svg>`;

// ------------------------------------------------------------
// Tabs
// ------------------------------------------------------------
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
window.addEventListener("resize", () => {
  const active = $(".tab.is-active");
  if (active) positionIndicator(active);
});
window.addEventListener("load", () => {
  const active = $(".tab.is-active");
  if (active) positionIndicator(active);
});

// ------------------------------------------------------------
// Chat
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Scroll reveal for "how it works" cards
// ------------------------------------------------------------
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