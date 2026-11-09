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
  const diseaseBoxes = [...document.querySelectorAll('input[name="disease"]')];
  const phoneInput = document.getElementById("phone");
  const noneBox = diseaseBoxes.find((box) => box.value === "None");
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
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    normalizeIndiaPhone();
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirmPassword").value;
    if (password.length < 8) return setMessage("Use a password with at least 8 characters.");
    if (password !== confirm) return setMessage("Passwords do not match.");
    const phoneNumber = document.getElementById("phone").value.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) return setMessage("Enter a mobile number with its international country code, such as +919876543210.");
    const registration = {
      fullName: document.getElementById("fullName").value.trim(),
      age: Number(document.getElementById("age").value),
      gender: document.getElementById("gender").value,
      phone: phoneNumber,
      location: document.getElementById("location").value.trim(),
      email: document.getElementById("email").value.trim().toLowerCase(),
      diseases: diseaseBoxes.filter((box) => box.checked && box.value !== "None").map((box) => box.value),
      healthInformation: document.getElementById("healthInfo").value.trim(),
    };
    setMessage("Creating your account…");
    try {
      await authPost("register", {
        ...registration,
        phoneNumber: registration.phone,
        termsAccepted: document.getElementById("terms").checked,
        password,
      });
      registration.registeredAt = new Date().toISOString();
      localStorage.setItem("airguardUser", JSON.stringify(registration));
      localStorage.setItem("airguardMobile", registration.phone);
      setMessage("Account created. Opening your dashboard…", "success");
      location.href = "/dashboard";
    } catch (error) { setMessage(error instanceof Error ? error.message : "Registration is temporarily unavailable."); }
  });
  const phoneNote = document.querySelector(".register-card .tiny-note");
  if (phoneNote) phoneNote.textContent = "Enter an Indian 10-digit mobile number or include +91. No OTP is required to create an account or sign in; this number is used for alerts you choose to receive.";
});
