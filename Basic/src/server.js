import express from "express";
import { decryptRequest, encryptResponse, FlowEndpointException } from "./encryption.js";
import { getNextScreen } from "./flow.js";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

const app = express();

app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf?.toString(encoding || "utf8");
    },
  })
);

const { APP_SECRET, PASSPHRASE = "", PORT = "3000" } = process.env;
const PRIVATE_KEY = fs.readFileSync("private_key_pkcs8.pem", "utf8");


// --- Your Verify Token ---
const VERIFY_TOKEN = "dahsrA*0812"; // change this to any secret phrase

// Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified ✅");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Webhook message receiver (POST)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Verification failed");
    res.sendStatus(403);
  }
});



app.post("/", async (req, res) => {
  if (!isRequestSignatureValid(req)) return res.status(432).send();

  let decryptedRequest;
  try {
    decryptedRequest = decryptRequest(req.body, PRIVATE_KEY, PASSPHRASE);
  } catch (err) {
    console.error("❌ Decryption error:", err);
    if (err instanceof FlowEndpointException) return res.status(err.statusCode).send();
    return res.status(500).send();
  }

  const { aesKeyBuffer, initialVectorBuffer, decryptedBody } = decryptedRequest;

  console.log("💬 Full Decrypted Request Payload:");
  console.log(JSON.stringify(decryptedBody, null, 2));

  const action = decryptedBody?.action?.toLowerCase?.() || "unknown";
  console.log(`🟡 Incoming Action: ${action}`);

  let response;

  try {
    switch (action) {
      case "init":
        console.log("⚙️ INIT request received");
        if (decryptedBody.flow_token) {
          console.log("🚀 Starting Flow — returning SCREEN_ONE");
          response = {
            screen: "SCREEN_ONE",
            data: {},
          };
        } else {
          console.log("🩺 Health check INIT — returning active");
          response = { data: { status: "active" } };
        }
        break;

      case "ping":
        console.log("📡 Ping received — replying with status active");
        response = { data: { status: "active" } };
        break;

      case "data_exchange":
        console.log("🔄 Data exchange received:");
        const dataExchange = decryptedBody?.data || {};

        // ✅ FORM DATA comes here when user submits the form
        const formData = dataExchange.form_data || {};
        const userInput = dataExchange.user_input || {}; // sometimes Meta sends user_input too

        if (Object.keys(formData).length > 0) {
          console.log("🧾 FORM DATA VALUES:");
          Object.entries(formData).forEach(([key, value]) => {
            console.log(`➡️ ${key}: ${value}`);
          });
        } else if (Object.keys(userInput).length > 0) {
          console.log("📝 USER INPUT VALUES:");
          Object.entries(userInput).forEach(([key, value]) => {
            console.log(`➡️ ${key}: ${value}`);
          });
        } else {
          console.log("⚠️ No form_data or user_input found.");
        }

        // Example: extract individual fields
        const name = formData.name || userInput.name;
         const phone = formData.number || userInput.number;
        const query = formData.query || userInput.query;

        console.log("👤 Extracted Values:", { name, phone, query });

        response = {
          action: "complete",
          screen: "CONFIRM_SCREEN",
          data: {
            success: true,
            message: `Form submitted successfully for ${name || "Unknown"}!`,
          },
        };
        break;

      default:
        console.warn(`⚠️ Unknown action: ${action}`);
        response = { error: "Unknown action" };
    }
  } catch (err) {
    console.error("❌ Error processing action:", err);
    response = { error: "Internal server error" };
  }

  console.log("👉 Response to Encrypt:", JSON.stringify(response, null, 2));
  res.send(encryptResponse(response, aesKeyBuffer, initialVectorBuffer));
});

app.get("/", (req, res) => {
  res.send(`<pre>WhatsApp Flow endpoint is running 🚀
POST / to test your flow requests.</pre>`);
});

app.listen(PORT, () => {
  console.log(`✅ Flow endpoint running on port ${PORT}`);
});

function isRequestSignatureValid(req) {
  if (!APP_SECRET) {
    console.warn("⚠️ App Secret not set. Add your app secret in .env for signature validation");
    return true;
  }

  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader) {
    console.error("❌ Missing signature header");
    return false;
  }

  const signatureBuffer = Buffer.from(signatureHeader.replace("sha256=", ""), "utf-8");
  const hmac = crypto.createHmac("sha256", APP_SECRET);
  const digestString = hmac.update(req.rawBody).digest("hex");
  const digestBuffer = Buffer.from(digestString, "utf-8");

  if (!crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
    console.error("❌ Error: Request signature did not match");
    return false;
  }
  return true;
}
