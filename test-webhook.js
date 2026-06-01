/**
 * Smoke test: POST /api/webhooks/engine (Clerk bypass + webhook secret).
 * Run: node test-webhook.js
 */

const WEBHOOK_URL = "https://shoal-web.vercel.app/api/webhooks/engine";

const payload = {
  swarmId: "test-123",
  status: "completed",
};

async function main() {
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-engine-webhook-secret": "shoal_vip_secret_2026",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  console.log("Status:", response.status);
  console.log("Response:", text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
