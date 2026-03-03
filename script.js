const startButton = document.getElementById("startButton");
const volumeLevel = document.getElementById("volumeLevel");
const zoneLabel = document.getElementById("zoneLabel");
const sensitivitySlider = document.getElementById("sensitivity");

let audioContext;
let analyser;
let microphone;
let zeroGain;
let dataArray;

let isRunning = false;
let animationId = null;

// Rolling window: last 60 seconds
const historyWindowMS = 60000;
const volumeHistory = []; // { time, value }

startButton.addEventListener("click", async () => {
  if (isRunning) return;

  try {
    isRunning = true;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    microphone = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    microphone.connect(analyser);

    // Keep processing active without audible output
    zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0;
    analyser.connect(zeroGain);
    zeroGain.connect(audioContext.destination);

    dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Reset history each run
    volumeHistory.length = 0;

    checkVolume();
  } catch (err) {
    console.error("Microphone error:", err);
    alert("Could not access microphone: " + err.message);
    isRunning = false;
  }
});

function checkVolume() {
  if (!isRunning) return;

  analyser.getByteFrequencyData(dataArray);

  // Instant volume (0..255-ish scale)
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
  const instant = sum / dataArray.length;

  const now = Date.now();

  // Save timestamped value
  volumeHistory.push({ time: now, value: instant });

  // Drop anything older than the window
  while (volumeHistory.length && now - volumeHistory[0].time > historyWindowMS) {
    volumeHistory.shift();
  }

  // Average over window
  let avgSum = 0;
  for (let i = 0; i < volumeHistory.length; i++) avgSum += volumeHistory[i].value;
  const average = avgSum / volumeHistory.length;

  volumeLevel.textContent = Math.round(average);

  updateColorAndLabel(average);

  animationId = requestAnimationFrame(checkVolume);
}

function updateColorAndLabel(level) {
  const greenMax = parseFloat(document.getElementById("greenMax").value);
  const yellowMax = parseFloat(document.getElementById("yellowMax").value);
  const orangeMax = parseFloat(document.getElementById("orangeMax").value);

  document.body.className = "";

  if (level <= greenMax) {
    document.body.classList.add("green");
    zoneLabel.textContent = "GREEN";
  } else if (level <= yellowMax) {
    document.body.classList.add("yellow");
    zoneLabel.textContent = "YELLOW";
  } else if (level <= orangeMax) {
    document.body.classList.add("orange");
    zoneLabel.textContent = "ORANGE";
  } else {
    document.body.classList.add("red");
    zoneLabel.textContent = "RED";
  }
}
