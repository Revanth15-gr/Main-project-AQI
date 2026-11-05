export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.TWILIO_ENABLED !== "true") return;
  const { validateTwilioConfiguration } = await import("@/lib/twilio/service");
  validateTwilioConfiguration();
}
