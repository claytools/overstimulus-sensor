const startButton = document.getElementById("startButton");
const volumeLevel = document.getElementById("volumeLevel");
const colorDisplay = document.getElementById("colorDisplay");
const sensitivitySlider = document.getElementById("sensitivity");

const volumeHistory = [];
const historyLength = 100; // ~1–2 seconds depending on FPS

let audioContext;
let analyser;
let microphone;
let zeroGain;
let dataArray;

let isRunning = false;
let animationId = null;

startButton.addEventListener("click", async () => {
    if (isRunning) return;

    try {
        isRunning = true;

        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Required in some browsers
        await audioContext.resume();

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        microphone = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;

        microphone.connect(analyser);

        // Ensure analyser stays active without hearing mic
        zeroGain = audioContext.createGain();
        zeroGain.gain.value = 0;
        analyser.connect(zeroGain);
        zeroGain.connect(audioContext.destination);

        dataArray = new Uint8Array(analyser.frequencyBinCount);

        // Reset history
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

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }

    const instant = sum / dataArray.length;

    // Add to history
    volumeHistory.push(instant);
    if (volumeHistory.length > historyLength) {
        volumeHistory.shift();
    }

    const average = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

    volumeLevel.textContent = Math.round(average);

    updateColor(average);

    animationId = requestAnimationFrame(checkVolume);
}

function updateColor(level) {
    const greenMax = parseFloat(document.getElementById("greenMax").value);
    const yellowMax = parseFloat(document.getElementById("yellowMax").value);
    const orangeMax = parseFloat(document.getElementById("orangeMax").value);

    colorDisplay.className = "";

    if (level <= greenMax) {
        colorDisplay.classList.add("green");
    } else if (level <= yellowMax) {
        colorDisplay.classList.add("yellow");
    } else if (level <= orangeMax) {
        colorDisplay.classList.add("orange");
    } else {
        colorDisplay.classList.add("red");
    }
}
