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
let dataArray;

// Loop control
let isRunning = false;
let animationId = null;

// Session time
let sessionStartMs = null;
let sessionEndMs = null;
let runtimeTimerId = null;

// Rolling histories (timestamped)
const fastWindowMS = 10000;   // responsive "now" reading
const slowWindowMS = 60000;   // 1-minute rolling avg for zones/logging
const instantHistory = [];    // { time, value }

// Sampling for the chart
const chartSampleEveryMS = 15000; // one point every 15 seconds
let lastChartSampleMs = 0;

// Logged series (for summary charts)
const loggedPoints = []; // { tMs, avg1m, zone }

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
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    microphone.connect(analyser);

    // Keep processing active without audible output
    zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0;
    analyser.connect(zeroGain);
    zeroGain.connect(audioContext.destination);

    dataArray = new Uint8Array(analyser.frequencyBinCount);

    lastZoneUpdateMs = Date.now();
    lastChartSampleMs = 0;

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
  // Ensure overlay is visible, then print
  summaryOverlay.classList.remove("hidden");
  window.print();
});

// Main loop
function checkVolume() {
  if (!isRunning) return;

  analyser.getByteFrequencyData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
  const instant = sum / dataArray.length;

  const now = Date.now();

  instantHistory.push({ time: now, value: instant });
  trimHistory(instantHistory, now, slowWindowMS);

  const fastAvg = rollingAverage(instantHistory, now, fastWindowMS);
  const slowAvg = rollingAverage(instantHistory, now, slowWindowMS);

  volumeLevel.textContent = Math.round(fastAvg);
  fastAvgEl.textContent = Math.round(fastAvg);
  slowAvgEl.textContent = Math.round(slowAvg);

  const zone = getZone(slowAvg);
  updateZone(zone);

  if (now - lastChartSampleMs >= chartSampleEveryMS) {
    lastChartSampleMs = now;
    loggedPoints.push({ tMs: now, avg1m: slowAvg, zone });
  }

  animationId = requestAnimationFrame(checkVolume);
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

  // Overall avg based on logged points (1-min avg values)
  if (loggedPoints.length) {
    const avg = loggedPoints.reduce((a, p) => a + p.avg1m, 0) / loggedPoints.length;
    sumOverallAvg.textContent = Math.round(avg);
  } else {
    sumOverallAvg.textContent = "—";
  }

  // Thresholds used
  const greenMax = parseFloat(document.getElementById("greenMax").value);
  const yellowMax = parseFloat(document.getElementById("yellowMax").value);
  const orangeMax = parseFloat(document.getElementById("orangeMax").value);
  sumThresholds.textContent = `Green≤${greenMax}, Yellow≤${yellowMax}, Orange≤${orangeMax}, Red>${orangeMax}`;

  sumSamples.textContent = String(loggedPoints.length);

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
  const data = loggedPoints.map(p => Math.round(p.avg1m));

  lineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "1-minute avg volume",
        data,
        tension: 0.25,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true } },
      scales: {
        x: { title: { display: true, text: "Elapsed time" } },
        y: { title: { display: true, text: "Volume (0–255 scale)" }, beginAtZero: true }
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

// Helpers
function trimHistory(arr, now, windowMS) {
  while (arr.length && now - arr[0].time > windowMS) arr.shift();
}

function rollingAverage(arr, now, windowMS) {
  let sum = 0;
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (now - arr[i].time > windowMS) break;
    sum += arr[i].value;
    count++;
  }
  return count ? (sum / count) : 0;
}

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
  instantHistory.length = 0;
  loggedPoints.length = 0;

  zoneTime.green = 0;
  zoneTime.yellow = 0;
  zoneTime.orange = 0;
  zoneTime.red = 0;

  currentZone = "green";
  lastZoneUpdateMs = Date.now();

  sessionStartMs = null;
  sessionEndMs = null;

  volumeLevel.textContent = "0";
  fastAvgEl.textContent = "0";
  slowAvgEl.textContent = "0";
  zoneLabel.textContent = "GREEN";
  startedAtEl.textContent = "—";
  runtimeEl.textContent = "00:00";
  document.body.className = "green";
}
