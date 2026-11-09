"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./LoginForm.module.css";

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success">("error");
  const mobileRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const savedEmail = window.localStorage.getItem("airguardRememberedEmail");
      if (savedEmail && emailRef.current && rememberRef.current) {
        emailRef.current.value = savedEmail;
        rememberRef.current.checked = true;
      }
    } catch {
      // Remembered email is optional; private browsing may disable storage.
    }
  }, []);

  function rememberEmail() {
    try {
      if (rememberRef.current?.checked && emailRef.current?.value.trim()) {
        window.localStorage.setItem("airguardRememberedEmail", emailRef.current.value.trim());
      } else {
        window.localStorage.removeItem("airguardRememberedEmail");
      }
    } catch {
      // Do not block sign-in when browser storage is unavailable.
    }
  }

  function addIndiaCountryCode() {
    const input = mobileRef.current;
    if (!input) return;
    const digits = input.value.trim().replace(/[\s()-]/g, "");
    if (/^[6-9]\d{9}$/.test(digits)) input.value = `+91${digits}`;
    else if (/^91[6-9]\d{9}$/.test(digits)) input.value = `+${digits}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addIndiaCountryCode();
    setMessageType("error");
    setMessage("Signing in…");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          email: emailRef.current?.value.trim() || "",
          password: (document.getElementById("password") as HTMLInputElement | null)?.value || "",
          phoneNumber: mobileRef.current?.value.trim() || "",
          rememberMe: rememberRef.current?.checked || false,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Sign-in is temporarily unavailable.");
      try { window.localStorage.setItem("airguardMobile", result.user.phoneNumber); } catch { /* Local storage is optional. */ }
      setMessageType("success");
      setMessage("Signed in. Opening your dashboard…");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Sign-in is temporarily unavailable.");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="login-title">
      <div className={styles.mobileBrand} aria-hidden="true">🌿 AIRGUARD</div>
      <span className={styles.eyebrow}>WELCOME BACK</span>
      <h2 id="login-title">Sign in to AirGuard</h2>
      <p className={styles.intro}>Your air-quality overview is one step away.</p>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field} htmlFor="mobileNumber">
          <span>Mobile number for WhatsApp alerts</span>
          <input id="mobileNumber" name="mobileNumber" type="tel" autoComplete="tel" inputMode="tel" placeholder="+919876543210" pattern="(?:\+[1-9][0-9]{7,14}|[6-9][0-9]{9}|91[6-9][0-9]{9})" title="Use +91 followed by your 10-digit Indian mobile number" ref={mobileRef} onBlur={addIndiaCountryCode} onChange={() => mobileRef.current?.setCustomValidity("")} required />
        </label>
        <label className={styles.field} htmlFor="email">
          <span>Email address</span>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" ref={emailRef} onChange={rememberEmail} required />
        </label>
        <label className={styles.field} htmlFor="password">
          <span>Password</span>
          <span className={styles.passwordRow}>
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required />
            <button className={styles.iconButton} type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>◉</button>
          </span>
        </label>
        <div className={styles.between}>
          <label className={styles.remember}><input type="checkbox" name="rememberMe" ref={rememberRef} onChange={rememberEmail} /> Remember me</label>
          <button className={styles.forgot} type="button" onClick={() => setMessage("Password recovery requires a configured authentication backend.")}>Forgot password?</button>
        </div>
        <button className={`${styles.button} ${styles.primary}`} type="submit">Sign in <span aria-hidden="true">→</span></button>
        <p className={`${styles.message} ${message ? styles[messageType] : ""}`} role="status" aria-live="polite">{message}</p>
      </form>

      <div className={styles.divider}><span />OR<span /></div>
      <Link className={`${styles.button} ${styles.secondary}`} href="/legacy/dashboard.html?demo=1">Explore demo dashboard</Link>
      <p className={styles.foot}>New to AirGuard? <Link href="/register">Create an account</Link></p>
      <p className={styles.note}>Use the mobile number saved to your account. No OTP is required to sign in; the public demo is available without an account.</p>
    </section>
  );
}
