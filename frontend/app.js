// CafeBot chat interface — UI only. No AI API, database, or auth.
// Bot replies below are static mock responses for demo purposes.

const chatArea = document.getElementById("chatArea");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");

// Seed conversation shown when the page loads.
const initialMessages = [
  { sender: "bot", text: "Hi there! Welcome to CafeBot ☕ How can I help you today?" },
  { sender: "user", text: "Hi! Can I see the menu?" },
  { sender: "bot", text: "Of course! We've got coffee, tea, pastries, breakfast, sandwiches, and desserts. What are you in the mood for?" },
];

// Mock bot replies, used round-robin for any message the user sends.
const mockReplies = [
  "Got it! Let me check that for you.",
  "Sounds good — anything else you'd like to add?",
  "That item is available today. Would you like to order it?",
  "Just to confirm, could you tell me the size you'd like?",
  "Thanks! I've noted that down.",
];
let replyIndex = 0;

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendMessage(sender, text) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatTime(new Date());
  bubble.appendChild(time);

  row.appendChild(bubble);
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
  return row;
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row bot";
  row.id = "typingIndicator";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';

  row.appendChild(bubble);
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function sendMockBotReply() {
  chatInput.disabled = true;
  sendButton.disabled = true;

  showTypingIndicator();
  setTimeout(() => {
    removeTypingIndicator();
    const reply = mockReplies[replyIndex % mockReplies.length];
    replyIndex += 1;
    appendMessage("bot", reply);

    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.focus();
  }, 700);
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  chatInput.value = "";
  sendMockBotReply();
});

// Ensure Enter reliably sends the message across browsers/input methods.
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

// Render the seeded conversation on load.
initialMessages.forEach((msg) => appendMessage(msg.sender, msg.text));
