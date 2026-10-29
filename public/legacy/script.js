
/* =========================================
   AIRGUARD - LOGIN PAGE FUNCTIONALITY
   Earth animation is handled by earth.js
========================================= */

document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  const loginForm = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const togglePassword = document.getElementById("togglePassword");
  const rememberMe = document.getElementById("rememberMe");
  const demoLogin = document.getElementById("demoLogin");
  const forgotLink = document.getElementById("forgotLink");
  const loginMessage = document.getElementById("loginMessage");

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
    loginForm.addEventListener("submit", function (event) {
      event.preventDefault();

      const email = emailInput.value.trim().toLowerCase();
      const password = passwordInput.value;

      if (!email || !password) {
        showMessage("Please enter your email and password.", "error");
        return;
      }

      if (!emailInput.checkValidity()) {
        showMessage("Please enter a valid email address.", "error");
        return;
      }

      /*
       * This page does not have a secure authentication backend.
       * Do not accept arbitrary credentials as a real login.
       * Connect your existing authentication implementation here.
       */
      showMessage(
        "Login authentication is not connected yet. Use the demo dashboard or connect your backend.",
        "error"
      );
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
