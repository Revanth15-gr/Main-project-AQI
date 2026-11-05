document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("registerForm");
  if (!form) return;
  const registerIntro = document.querySelector(".register-intro");
  if (registerIntro) {
    const earth = document.createElement("div");
    earth.className = "earth-wrap";
    earth.innerHTML = '<div id="globe" role="img" aria-label="Realistic rotating 3D Earth"></div><span class="orbit orbit-a" aria-hidden="true"></span><span class="orbit orbit-b" aria-hidden="true"></span><span class="float-chip chip-a">◉ Cleaner air</span><span class="float-chip chip-b">✦ Smart prediction</span><span class="float-chip chip-c">♡ Health first</span>';
    registerIntro.prepend(earth);
    const three = document.createElement("script");
    three.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    three.onload = () => { const earthScript = document.createElement("script"); earthScript.src = "/legacy/earth.js"; document.body.append(earthScript); };
    document.head.append(three);
  }
  const message = document.getElementById("registerMessage");
  const verificationPanel = document.getElementById("phoneVerification");
  const codeInput = document.getElementById("phoneCode");
  const verificationButton = document.getElementById("verifyPhone");
  const diseaseBoxes = [...document.querySelectorAll('input[name="disease"]')];
  const phoneInput = document.getElementById("phone");
  const noneBox = diseaseBoxes.find((box) => box.value === "None");
  let registration = null;
  let stage = "register";
  if (phoneInput) phoneInput.pattern = "(?:\\+[1-9][0-9]{7,14}|[6-9][0-9]{9}|91[6-9][0-9]{9})";

  const normalizeIndiaPhone = () => {
    if (!phoneInput) return;
    const digits = phoneInput.value.trim().replace(/[\s()-]/g, "");
    if (/^[6-9]\d{9}$/.test(digits)) phoneInput.value = `+91${digits}`;
    else if (/^91[6-9]\d{9}$/.test(digits)) phoneInput.value = `+${digits}`;
  };
  phoneInput?.addEventListener("blur", normalizeIndiaPhone);

  diseaseBoxes.forEach((box) => box.addEventListener("change", () => {
    if (box === noneBox && noneBox.checked) diseaseBoxes.filter((item) => item !== noneBox).forEach((item) => { item.checked = false; });
    else if (box.checked && noneBox) noneBox.checked = false;
  }));

  function setMessage(text, type = "error") {
    message.textContent = text;
    message.className = `form-message ${type}`;
  }

  async function authPost(path, body) {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !payload.pendingVerification) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  function showVerification(messageText) {
    stage = "verify";
    verificationPanel.hidden = false;
    codeInput.disabled = false;
    codeInput.required = true;
    verificationButton.textContent = "Verify mobile number";
    setMessage(messageText, "success");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    normalizeIndiaPhone();
    if (stage !== "register") return;
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirmPassword").value;
    if (password.length < 8) return setMessage("Use a password with at least 8 characters.");
    if (password !== confirm) return setMessage("Passwords do not match.");
    const phoneNumber = document.getElementById("phone").value.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) return setMessage("Enter a mobile number with its international country code, such as +919876543210.");
    registration = {
      fullName: document.getElementById("fullName").value.trim(),
      age: Number(document.getElementById("age").value),
      gender: document.getElementById("gender").value,
      phone: phoneNumber,
      location: document.getElementById("location").value.trim(),
      email: document.getElementById("email").value.trim().toLowerCase(),
      diseases: diseaseBoxes.filter((box) => box.checked && box.value !== "None").map((box) => box.value),
      healthInformation: document.getElementById("healthInfo").value.trim(),
    };
    setMessage("Creating your account and sending a verification code…");
    try {
      const result = await authPost("register", {
        ...registration,
        phoneNumber: registration.phone,
        termsAccepted: document.getElementById("terms").checked,
        password,
      });
      const channelLabel = result.channel === "sms" ? "SMS" : "WhatsApp";
      showVerification(result.error || `We sent a ${channelLabel} code. Enter it below to verify your mobile number.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Registration is temporarily unavailable."); }
  });

  verificationButton.addEventListener("click", async () => {
    if (!registration) return;
    const code = codeInput.value.trim();
    verificationButton.disabled = true;
    try {
      if (!code) {
        const delivery = await authPost("resend-verification", { email: registration.email, phoneNumber: registration.phone });
        setMessage(`A new ${delivery.channel === "sms" ? "SMS" : "WhatsApp"} code has been sent.`, "success");
        return;
      }
      if (!/^\d{6}$/.test(code)) { setMessage("Enter the six-digit code from the SMS."); return; }
      setMessage("Verifying your mobile number…");
      await authPost("verify-phone", { email: registration.email, code });
      registration.registeredAt = new Date().toISOString();
      localStorage.setItem("airguardUser", JSON.stringify(registration));
      localStorage.setItem("airguardMobile", registration.phone);
      setMessage("Mobile number verified. Opening your dashboard…", "success");
      location.href = "/dashboard";
    } catch (error) { setMessage(error instanceof Error ? error.message : "Phone verification failed. Request another code and try again."); }
    finally { verificationButton.disabled = false; }
  });
  if (codeInput) codeInput.placeholder = "Enter the six-digit code from WhatsApp";
  const verificationLabel = document.querySelector("#phoneVerification label");
  if (verificationLabel) verificationLabel.firstChild.textContent = "WhatsApp verification code";
  const phoneNote = document.querySelector(".register-card .tiny-note");
  if (phoneNote) phoneNote.textContent = "Enter an Indian 10-digit mobile number or include +91. We will send a WhatsApp verification code when your Twilio WhatsApp template is configured.";
});
