const $ = (id) => document.getElementById(id);

let callId = null;
let active = false;
let processing = false;
let isSpeaking = false;
let startTime = 0;
let seconds = 0;
let timer = null;
let recorder = null;
let chunks = [];
let stream = null;
let recognition = null;
let recognitionAvailable = false;
let finalTranscript = "";
let restartRecognitionTimer = null;

async function post(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function setMicStatus(text) {
  const el = $("mic");
  if (el) el.textContent = text;
}

function addMessage(role, text) {
  if ($("chat").querySelector(".empty")) $("chat").innerHTML = "";
  const message = document.createElement("div");
  message.className = `msg ${role}`;
  const label = document.createElement("span");
  label.className = "who";
  label.textContent = role === "assistant" ? "AI SALES BOT" : "CUSTOMER";
  const content = document.createElement("span");
  content.textContent = text;
  message.append(label, content);
  $("chat").append(message);
  $("chat").scrollTop = $("chat").scrollHeight;
  $("count").textContent = `${$("chat").children.length} messages`;
}

function stopRecognition() {
  if (restartRecognitionTimer) {
    clearTimeout(restartRecognitionTimer);
    restartRecognitionTimer = null;
  }
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
  }
}

function startRecognition() {
  if (!active || !recognitionAvailable || isSpeaking || processing) return;
  try {
    recognition.start();
    setMicStatus("Listening — speak naturally");
  } catch (_) {
    // The browser may still be finishing a prior recognition session.
    restartRecognitionTimer = setTimeout(() => {
      if (active && !isSpeaking && !processing) startRecognition();
    }, 700);
  }
}

function makeRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    recognitionAvailable = false;
    setMicStatus("Speech recognition unavailable — use the text box");
    return;
  }

  recognitionAvailable = true;
  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => setMicStatus("Listening — speak naturally");

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += phrase;
      else interim += phrase;
    }
    if (interim) setMicStatus(`Hearing: “${interim.trim()}”`);
    if (finalText.trim() && active && !processing && !isSpeaking) {
      finalTranscript = finalText.trim();
      stopRecognition();
      handleCustomerTurn(finalTranscript);
    }
  };

  recognition.onerror = (event) => {
    const messages = {
      "not-allowed": "Microphone blocked — allow it in Chrome site settings",
      "service-not-allowed": "Speech service blocked — check browser/network",
      "no-speech": "No speech detected — try speaking a little louder",
      "audio-capture": "No microphone found — check Windows input settings",
      "network": "Speech service network error — check internet or type instead"
    };
    setMicStatus(messages[event.error] || `Speech error: ${event.error}`);
  };

  recognition.onend = () => {
    if (active && !isSpeaking && !processing) {
      restartRecognitionTimer = setTimeout(startRecognition, 450);
    }
  };
}

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      setMicStatus("Text response shown; speech output is unsupported");
      resolve();
      return;
    }
    isSpeaking = true;
    stopRecognition();
    setMicStatus("Sales assistant speaking…");
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 0.96;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang.toLowerCase() === "en-in")
      || voices.find(v => v.lang.toLowerCase().startsWith("en-"));
    if (preferredVoice) utterance.voice = preferredVoice;

    const finishSpeaking = () => {
      isSpeaking = false;
      resolve();
      if (active && !processing) {
        setTimeout(startRecognition, 350);
      }
    };
    utterance.onend = finishSpeaking;
    utterance.onerror = finishSpeaking;
    window.speechSynthesis.speak(utterance);
  });
}

async function handleCustomerTurn(text) {
  if (!active || processing || !text.trim()) return;
  processing = true;
  stopRecognition();
  addMessage("user", text);
  setMicStatus("Thinking about the customer's needs…");
  try {
    const result = await post(`/api/message/${callId}/`, { text });
    addMessage("assistant", result.reply);
    processing = false;
    await speak(result.reply);
  } catch (error) {
    processing = false;
    setMicStatus("Reply failed — check internet/API status or type a message");
    addMessage("assistant", "Sorry, I had trouble responding. Please try again or type your message.");
    console.error(error);
    if (active) setTimeout(startRecognition, 500);
  }
}

$("send").onclick = async () => {
  const text = $("typed").value.trim();
  if (!text || !active || processing) return;
  $("typed").value = "";
  await handleCustomerTurn(text);
};
$("typed").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("send").click();
  }
};

$("start").onclick = async () => {
  if (!$("consent").checked) {
    alert("Please confirm that the customer has been informed and consents to recording.");
    return;
  }

  $("start").disabled = true;
  setMicStatus("Requesting microphone permission…");

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone access is unavailable. Use Chrome or Edge on localhost.");
    }

    // Request the microphone before creating the call, so permission failures do not
    // leave empty call records in the database.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const startResult = await post("/api/start/", {
      product: $("product").value,
      consent: true
    });
    callId = startResult.id;
    active = true;
    processing = false;
    isSpeaking = false;
    seconds = 0;
    startTime = Date.now();
    chunks = [];

    $("chat").innerHTML = "";
    addMessage("assistant", startResult.greeting);
    $("status").textContent = "Live";
    $("end").disabled = false;
    $("typed").disabled = false;
    $("send").disabled = false;

    try {
      if (window.MediaRecorder) {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.start(500);
      } else {
        setMicStatus("Live; this browser cannot save microphone recordings");
      }
    } catch (recordError) {
      console.warn("Recording unavailable:", recordError);
      setMicStatus("Live, but browser recording is unavailable");
    }

    timer = setInterval(() => {
      seconds = Math.floor((Date.now() - startTime) / 1000);
      $("duration").textContent =
        `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }, 500);

    makeRecognition();
    await speak(startResult.greeting);
    if (!recognitionAvailable) $("typed").focus();
  } catch (error) {
    console.error(error);
    alert(`Could not start the call: ${error.message}`);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    $("start").disabled = false;
    setMicStatus("Microphone off");
  }
};

$("end").onclick = async () => {
  if (!active) return;
  active = false;
  processing = false;
  clearInterval(timer);
  stopRecognition();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  isSpeaking = false;

  if (recorder && recorder.state !== "inactive") {
    await new Promise((resolve) => {
      recorder.addEventListener("stop", resolve, { once: true });
      try { recorder.stop(); } catch (_) { resolve(); }
    });
  }
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  $("status").textContent = "Saving…";
  $("end").disabled = true;
  $("send").disabled = true;
  $("typed").disabled = true;
  setMicStatus("Saving call details…");

  if (chunks.length && callId) {
    try {
      const mimeType = (chunks[0] && chunks[0].type) || "audio/webm";
      const form = new FormData();
      form.append("audio", new Blob(chunks, { type: mimeType }), `call_${callId}.webm`);
      const response = await fetch(`/api/recording/${callId}/`, { method: "POST", body: form });
      const result = await response.json();
      if (response.ok && result.url) {
        $("player").src = result.url;
        $("player").classList.remove("hidden");
        $("recordLink").href = result.url;
        $("recordLink").classList.remove("hidden");
        $("recordEmpty").classList.add("hidden");
      } else {
        console.warn("Recording upload failed:", result.error);
      }
    } catch (error) {
      console.error("Recording upload failed:", error);
    }
  }

  try {
    const result = await post(`/api/finish/${callId}/`, { duration: seconds });
    $("salesStatus").textContent = result.status;
    $("sum").textContent = result.summary;
    $("req").textContent = result.requirements;
    $("obj").textContent = result.objections;
    $("next").textContent = result.next_steps;
    $("sumEmpty").classList.add("hidden");
    $("summary").classList.remove("hidden");
    $("status").textContent = "Ended";
    setMicStatus("Call ended");
    $("start").disabled = false;
    // Reload so the new call and its saved summary appear in history.
    setTimeout(() => window.location.reload(), 1800);
  } catch (error) {
    console.error(error);
    alert(`Call ended, but saving the summary failed: ${error.message}`);
    $("status").textContent = "Ended — summary error";
    $("start").disabled = false;
  }
};
