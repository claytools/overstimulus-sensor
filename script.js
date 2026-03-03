const startButton = document.getElementById("startButton");
const volumeLevel = document.getElementById("volumeLevel");
const colorDisplay = document.getElementById("colorDisplay");
const sensitivitySlider = document.getElementById("sensitivity");

let audioContext;
let analyser;
let microphone;

startButton.addEventListener("click", async () => {

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  microphone = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;

  microphone.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function checkVolume() {
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }

    let average = sum / dataArray.length;
    volumeLevel.textContent = Math.round(average);

    updateColor(average);

    requestAnimationFrame(checkVolume);
  }

  checkVolume();
});

function updateColor(level) {
  let sensitivity = sensitivitySlider.value;

  colorDisplay.className = "";

  if (level < sensitivity * 0.5) {
    colorDisplay.classList.add("green");
  } else if (level < sensitivity * 0.75) {
    colorDisplay.classList.add("yellow");
  } else if (level < sensitivity) {
    colorDisplay.classList.add("orange");
  } else {
    colorDisplay.classList.add("red");
  }
}
