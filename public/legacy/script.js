
/* =========================================
   AIRGUARD - LOGIN PAGE FUNCTIONALITY
   Earth animation is handled by earth.js
========================================= */

document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  const loginForm = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  let mobileInput = document.getElementById("mobileNumber");
  const togglePassword = document.getElementById("togglePassword");
  const rememberMe = document.getElementById("rememberMe");
  const demoLogin = document.getElementById("demoLogin");
  const forgotLink = document.getElementById("forgotLink");
  const loginMessage = document.getElementById("loginMessage");

  if (loginForm && emailInput && !mobileInput) {
    const mobileLabel = document.createElement("label");
    mobileLabel.htmlFor = "mobileNumber";
    mobileLabel.textContent = "Mobile number for WhatsApp alerts";
    mobileInput = document.createElement("input");
    mobileInput.id = "mobileNumber";
    mobileInput.name = "mobileNumber";
    mobileInput.type = "tel";
    mobileInput.autocomplete = "tel";
    mobileInput.inputMode = "tel";
    mobileInput.placeholder = "+919876543210";
    mobileInput.pattern = "(?:\\+[1-9][0-9]{7,14}|[6-9][0-9]{9}|91[6-9][0-9]{9})";
    mobileInput.required = true;
    mobileLabel.append(mobileInput);
    emailInput.closest("label")?.before(mobileLabel);
  }
  mobileInput?.addEventListener("blur", () => {
    const digits = mobileInput.value.trim().replace(/[\s()-]/g, "");
    if (/^[6-9]\d{9}$/.test(digits)) mobileInput.value = `+91${digits}`;
    else if (/^91[6-9]\d{9}$/.test(digits)) mobileInput.value = `+${digits}`;
  });

  // Set the current year
  document.querySelectorAll("[data-year]").forEach(function (element) {
    element.textContent = new Date().getFullYear();
  });

  // Display messages accessibly
  function showMessage(message, type) {
    if (!loginMessage) return;

    loginMessage.textContent = message;
    loginMessage.classList.remove("success", "error");

    if (type) {
      loginMessage.classList.add(type);
    }
  }

  // Show or hide the password
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
      const showingPassword = passwordInput.type === "text";

      passwordInput.type = showingPassword ? "password" : "text";

      togglePassword.setAttribute(
        "aria-label",
        showingPassword ? "Show password" : "Hide password"
      );

      togglePassword.setAttribute(
        "aria-pressed",
        String(!showingPassword)
      );
    });
  }

  // Restore the remembered email address
  if (emailInput && rememberMe) {
    try {
      const savedEmail = localStorage.getItem("airguardRememberedEmail");

      if (savedEmail) {
        emailInput.value = savedEmail;
        rememberMe.checked = true;
      }
    } catch (error) {
      console.warn("Remembered email is unavailable in this browser.");
    }

    rememberMe.addEventListener("change", function () {
      try {
        if (rememberMe.checked && emailInput.value.trim()) {
          localStorage.setItem(
            "airguardRememberedEmail",
            emailInput.value.trim()
          );
        } else {
          localStorage.removeItem("airguardRememberedEmail");
        }
      } catch (error) {
        console.warn("Could not save the remembered email.");
      }
    });
  }

  // Demo dashboard access
  if (demoLogin) {
    demoLogin.addEventListener("click", function () {
      window.location.href = "dashboard.html";
    });
  }

  // Login form
  if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const phoneDigits = mobileInput?.value.trim().replace(/[\s()-]/g, "") || "";
      if (/^[6-9]\d{9}$/.test(phoneDigits)) mobileInput.value = `+91${phoneDigits}`;
      else if (/^91[6-9]\d{9}$/.test(phoneDigits)) mobileInput.value = `+${phoneDigits}`;

      const email = emailInput.value.trim().toLowerCase();
      const password = passwordInput.value;
      const phoneNumber = mobileInput?.value.trim() || "";

      if (!email || !password || !phoneNumber) {
        showMessage("Please enter your mobile number, email and password.", "error");
        return;
      }

      if (!emailInput.checkValidity()) {
        showMessage("Please enter a valid email address.", "error");
        return;
      }

      const submit = loginForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      showMessage("Signing in…");
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ email, password, phoneNumber }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Sign-in failed (${response.status}).`);
        try { localStorage.setItem("airguardMobile", result.user.phoneNumber); } catch { /* Storage is optional. */ }
        showMessage("Signed in. Opening your dashboard…", "success");
        window.location.href = "/dashboard";
      } catch (error) {
        showMessage(error instanceof Error ? error.message : "Sign-in is temporarily unavailable.", "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  // Forgot-password interaction
  if (forgotLink) {
    forgotLink.addEventListener("click", function (event) {
      event.preventDefault();

      const email = emailInput ? emailInput.value.trim() : "";

      if (!email) {
        showMessage(
          "Enter your email address first. Password recovery requires a connected backend.",
          "error"
        );

        if (emailInput) emailInput.focus();
        return;
      }

      showMessage(
        "Password recovery is not configured yet. Please connect an email or authentication service.",
        "error"
      );
    });
  }
});
