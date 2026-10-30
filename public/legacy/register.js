document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("registerForm");
  if (!form) return;
  const message = document.getElementById("registerMessage");
  const none = [...document.querySelectorAll('input[name="disease"]')].find((input) => input.value === "None");
  const diseases = [...document.querySelectorAll('input[name="disease"]')];

  diseases.forEach((box) => box.addEventListener("change", () => {
    if (box === none && none.checked) diseases.filter((item) => item !== none).forEach((item) => { item.checked = false; });
    else if (box.checked && none) none.checked = false;
  }));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirmPassword").value;
    if (password.length < 8) { message.textContent = "Use a password with at least 8 characters."; return; }
    if (password !== confirm) { message.textContent = "Passwords do not match."; return; }

    const email = document.getElementById("email").value.trim();
    const name = document.getElementById("fullName").value.trim();
    if (!name || !email) { message.textContent = "Please complete all required fields."; return; }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Registration failed.");
      message.textContent = "Account created. Redirecting…";
      message.style.color = "#087b59";
      window.location.assign("/dashboard");
    } catch (error) {
      message.textContent = error.message || "Registration failed. Please try again.";
    }
  });
});
