// UI
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

const volumeLevel = document.getElementById("volumeLevel");
const zoneLabel = document.getElementById("zoneLabel");

const startedAtEl = document.getElementById("startedAt");
const runtimeEl = document.getElementById("runtime");
const fastAvgEl = document.getElementById("fastAvg");
const slowAvgEl = document.getElementById("slowAvg");

const summaryOverlay = document.getElementById("summaryOverlay");
const closeSummaryBtn = document.getElementById("closeSummary");
const printSummaryBtn = document.getElementById("printSummary");

const sumTotal = document.getElementById("sumTotal");
const sumGreen = document.getElementById("sumGreen");
const sumYellow = document.getElementById("sumYellow");
const sumOrange = document.getElementById("sumOrange");
const sumRed = document.getElementById("sumRed");
const sumStart = document.getElementById("sumStart");
const sumEnd = document.getElementById("sumEnd");

const sumOverallAvg = document.getElementById("sumOverallAvg");
const sumThresholds = document.getElementById("sumThresholds");
const sumSamples = document.getElementById("sumSamples");

// Audio
let audioContext;
let analyser;
let microphone;
let zeroGain;

// Time-domain buffer for RMS
let timeData;

// Loop control
let isRunning = false;
let animationId = null;

// Session time
let sessionStartMs = null;
let sessionEndMs = null;
let runtimeTimerId = null;

// Rolling window histories (timestamped RMS)
const fastWindowMS = 8000;    // 🔥 responsive live feel (try 6000–12000)
const slowWindowMS = 60000;   // ✅ 1-minute window for zones “truth”
const rmsHistory = [];        // { time, value } where value is 0..255-ish RMS

// Per-minute logging buckets
const minuteWindowMS = 60000;
let currentMinuteIndex = null;
let currentMinuteSamples = []; // raw RMS samples for the active minute

// Logged per-minute points for charts
// { tMs (minute start), mean, p95, combo, zone }
const loggedPoints = [];

// Zone timing (ms)
let lastZoneUpdateMs = 0;
const zoneTime = { green: 0, yellow: 0, orange: 0, red: 0 };
let currentZone = "green";

// Charts
let lineChart = null;
let pieChart = null;

// Zone colors (match screen & pie chart)
const ZONE_COLORS = {
  green: "#2ecc71",
  yellow: "#f1c40f",
  orange: "#e67e22",
  red: "#e74c3c"
};

startButton.addEventListener("click", async () => {
  if (isRunning) return;

  try {
    hideSummary();
    resetSession();

    isRunning = true;
    startButton.disabled = true;
    stopButton.disabled = false;

    sessionStartMs = Date.now();
    startedAtEl.textContent = formatClockTime(sessionStartMs);
    runtimeEl.textContent = "00:00";

    runtimeTimerId = setInterval(() => {
      runtimeEl.textContent = formatDuration(Date.now() - sessionStartMs);
    }, 250);

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    microphone = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();

    // Larger window gives steadier RMS
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.0; // we do our own smoothing via windows

    microphone.connect(analyser);

    // Keep processing active without audible output
    zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0;
    analyser.connect(zeroGain);
    zeroGain.connect(audioContext.destination);

    timeData = new Uint8Array(analyser.fftSize);

    lastZoneUpdateMs = Date.now();

    // Minute bucket init
    currentMinuteIndex = 0;
    currentMinuteSamples = [];

    checkVolume();
  } catch (err) {
    console.error("Microphone error:", err);
    alert("Could not access microphone: " + err.message);
    stopMonitoring();
  }
});

stopButton.addEventListener("click", () => {
  if (!isRunning) return;
  stopMonitoring();
  showSummary();
});

closeSummaryBtn.addEventListener("click", () => hideSummary());

printSummaryBtn.addEventListener("click", () => {
  summaryOverlay.classList.remove("hidden");
  window.print();
});

// Main loop
function checkVolume() {
  if (!isRunning) return;

  // 1) Measure loudness via RMS (time-domain)
  analyser.getByteTimeDomainData(timeData);

  // Convert 0..255 to -1..1, compute RMS
  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128; // approx -1..1
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);

  // Scale RMS to 0..255-ish for consistency with your thresholds
  const instant = rms * 255;

  const now = Date.now();

  // 2) Save RMS to history (for rolling windows)
  rmsHistory.push({ time: now, value: instant });
  trimHistory(rmsHistory, now, slowWindowMS);

  // 3) Fast/slow stats
  const fastMean = rollingMean(rmsHistory, now, fastWindowMS);
  const slowMean = rollingMean(rmsHistory, now, slowWindowMS);
  const slowP95 = rollingPercentile(rmsHistory, now, slowWindowMS, 0.95);

  // Combo metric: half mean, half near-peak (robust to one-offs)
  const slowCombo = 0.5 * slowMean + 0.5 * slowP95;

  // Display:
  // Big number = fast mean (responsive)
  // Fast Avg = fast mean
  // Log Avg (1 min) = combo (mean + p95)/2 (what zones use)
  volumeLevel.textContent = Math.round(fastMean);
  fastAvgEl.textContent = Math.round(fastMean);
  slowAvgEl.textContent = Math.round(slowCombo);

  // 4) Zones based on 1-minute combo
  const zone = getZone(slowCombo);
  updateZone(zone);

  // 5) Per-minute logging (mean + p95 for each minute)
  const minuteIndex = Math.floor((now - sessionStartMs) / minuteWindowMS);

  // If we moved into a new minute, finalize the previous minute
  if (currentMinuteIndex === null) currentMinuteIndex = minuteIndex;

  if (minuteIndex !== currentMinuteIndex) {
    finalizeMinuteBucket(currentMinuteIndex);
    currentMinuteIndex = minuteIndex;
    currentMinuteSamples = [];
  }

  // Add the instant RMS sample to current minute bucket
  currentMinuteSamples.push(instant);

  animationId = requestAnimationFrame(checkVolume);
}

// Finalize one minute’s bucket into loggedPoints
function finalizeMinuteBucket(minuteIdx) {
  if (!sessionStartMs) return;
  if (!currentMinuteSamples.length) return;

  const minuteStartMs = sessionStartMs + minuteIdx * minuteWindowMS;

  const mean = arrayMean(currentMinuteSamples);
  const p95 = arrayPercentile(currentMinuteSamples, 0.95);
  const combo = 0.5 * mean + 0.5 * p95;

  const zone = getZone(combo);

  loggedPoints.push({
    tMs: minuteStartMs,
    mean,
    p95,
    combo,
    zone
  });
}

// Zone logic
function getZone(level) {
  const greenMax = parseFloat(document.getElementById("greenMax").value);
  const yellowMax = parseFloat(document.getElementById("yellowMax").value);
  const orangeMax = parseFloat(document.getElementById("orangeMax").value);

  if (level <= greenMax) return "green";
  if (level <= yellowMax) return "yellow";
  if (level <= orangeMax) return "orange";
  return "red";
}

function updateZone(newZone) {
  const now = Date.now();

  const dt = now - lastZoneUpdateMs;
  if (dt > 0) zoneTime[currentZone] += dt;

  currentZone = newZone;
  lastZoneUpdateMs = now;

  document.body.className = newZone;
  zoneLabel.textContent = newZone.toUpperCase();
}

// Stop
function stopMonitoring() {
  if (!isRunning) return;

  isRunning = false;
  sessionEndMs = Date.now();

  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;

  if (runtimeTimerId) clearInterval(runtimeTimerId);
  runtimeTimerId = null;

  // Final zone time accumulation
  const now = Date.now();
  const dt = now - lastZoneUpdateMs;
  if (dt > 0) zoneTime[currentZone] += dt;

  // Finalize the current minute bucket so the chart includes it
  if (sessionStartMs !== null && currentMinuteIndex !== null) {
    finalizeMinuteBucket(currentMinuteIndex);
  }

  try { audioContext && audioContext.close(); } catch (_) {}

  startButton.disabled = false;
  stopButton.disabled = true;
}

// Summary
function showSummary() {
  const end = sessionEndMs ?? Date.now();
  const start = sessionStartMs ?? end;
  const total = end - start;

  sumTotal.textContent = formatDuration(total);
  sumGreen.textContent = formatDuration(zoneTime.green);
  sumYellow.textContent = formatDuration(zoneTime.yellow);
  sumOrange.textContent = formatDuration(zoneTime.orange);
  sumRed.textContent = formatDuration(zoneTime.red);

  sumStart.textContent = sessionStartMs ? formatClockTime(sessionStartMs) : "—";
  sumEnd.textContent = sessionEndMs ? formatClockTime(sessionEndMs) : "—";

  // Thresholds used
  const greenMax = parseFloat(document.getElementById("greenMax").value);
  const yellowMax = parseFloat(document.getElementById("yellowMax").value);
  const orangeMax = parseFloat(document.getElementById("orangeMax").value);
  sumThresholds.textContent = `Green≤${greenMax}, Yellow≤${yellowMax}, Orange≤${orangeMax}, Red>${orangeMax}`;

  sumSamples.textContent = String(loggedPoints.length); // now "minutes logged"

  // Overall stats from per-minute points
  if (loggedPoints.length) {
    const overallMean = loggedPoints.reduce((a, p) => a + p.mean, 0) / loggedPoints.length;
    const overallP95 = loggedPoints.reduce((a, p) => a + p.p95, 0) / loggedPoints.length;
    const overallCombo = 0.5 * overallMean + 0.5 * overallP95;

    // Fits existing label, but includes all three values
    sumOverallAvg.textContent =
      `Mean ${Math.round(overallMean)} | P95 ${Math.round(overallP95)} | Combo ${Math.round(overallCombo)}`;
  } else {
    sumOverallAvg.textContent = "—";
  }

  renderLineChart();
  renderPieChart();

  summaryOverlay.classList.remove("hidden");
}

function hideSummary() {
  summaryOverlay.classList.add("hidden");
}

// Charts
function renderLineChart() {
  const ctx = document.getElementById("lineChart").getContext("2d");
  if (lineChart) lineChart.destroy();

  const labels = loggedPoints.map(p => formatElapsed(p.tMs - sessionStartMs));
  const meanData = loggedPoints.map(p => Math.round(p.mean));
  const p95Data = loggedPoints.map(p => Math.round(p.p95));

  lineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Per-minute mean (RMS)",
          data: meanData,
          tension: 0.25,
          pointRadius: 2
        },
        {
          label: "Per-minute 95th percentile (RMS)",
          data: p95Data,
          tension: 0.25,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true } },
      scales: {
        x: { title: { display: true, text: "Elapsed time" } },
        y: { title: { display: true, text: "Loudness (0–255 RMS scale)" }, beginAtZero: true }
      }
    }
  });
}

function renderPieChart() {
  const ctx = document.getElementById("pieChart").getContext("2d");
  if (pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: ["Green", "Yellow", "Orange", "Red"],
      datasets: [{
        data: [
          Math.round(zoneTime.green / 1000),
          Math.round(zoneTime.yellow / 1000),
          Math.round(zoneTime.orange / 1000),
          Math.round(zoneTime.red / 1000)
        ],
        backgroundColor: [
          ZONE_COLORS.green,
          ZONE_COLORS.yellow,
          ZONE_COLORS.orange,
          ZONE_COLORS.red
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

// Rolling window helpers
function trimHistory(arr, now, windowMS) {
  while (arr.length && now - arr[0].time > windowMS) arr.shift();
}

function rollingMean(arr, now, windowMS) {
  let sum = 0;
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (now - arr[i].time > windowMS) break;
    sum += arr[i].value;
    count++;
  }
  return count ? (sum / count) : 0;
}

function rollingPercentile(arr, now, windowMS, p) {
  const values = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (now - arr[i].time > windowMS) break;
    values.push(arr[i].value);
  }
  return values.length ? arrayPercentile(values, p) : 0;
}

// Array stats
function arrayMean(values) {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return s / values.length;
}

function arrayPercentile(values, p) {
  // p in [0,1], e.g. 0.95
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const idx = Math.max(0, Math.min(n - 1, Math.ceil(p * n) - 1));
  return sorted[idx];
}

// Formatting
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatClockTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function resetSession() {
  rmsHistory.length = 0;
  loggedPoints.length = 0;

  zoneTime.green = 0;
  zoneTime.yellow = 0;
  zoneTime.orange = 0;
  zoneTime.red = 0;

  currentZone = "green";
  lastZoneUpdateMs = Date.now();

  sessionStartMs = null;
  sessionEndMs = null;

  currentMinuteIndex = null;
  currentMinuteSamples = [];

  volumeLevel.textContent = "0";
  fastAvgEl.textContent = "0";
  slowAvgEl.textContent = "0";
  zoneLabel.textContent = "GREEN";
  startedAtEl.textContent = "—";
  runtimeEl.textContent = "00:00";
  document.body.className = "green";
}
