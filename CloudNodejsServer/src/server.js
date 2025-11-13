import express from "express";
import { decryptRequest, encryptResponse, FlowEndpointException } from "./encryption.js";
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
const PRIVATE_KEY = process.env.PRIVATE_KEY.replace(/\\n/g, "\n");
const VERIFY_TOKEN = "dahsrA*0812";

/* ------------------- WEBHOOK VERIFICATION ------------------- */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Verification failed");
    res.sendStatus(403);
  }
});

global.lastFormData = {};
/* ------------------- MAIN FLOW ENDPOINT ------------------- */
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

  console.log("\n===============================");
  console.log("💬 Full Decrypted Request Payload:");
  console.log(JSON.stringify(decryptedBody, null, 2));
  console.log("===============================\n");

  const action = decryptedBody?.action?.toLowerCase?.() || "unknown";
  console.log(`🟡 Incoming Action: ${action}`);

  let response;

  try {
    /* 1️⃣ INIT — user opens the flow */
    if (action === "init") {
      console.log("⚙️ INIT request received");
      response = {
        screen: "COUNTRY_SELECTION",
        data: {
          service: [
            { id: "1", title: "Search Engine Optimization" },
            { id: "2", title: "Social Media Marketing" },
            { id: "3", title: "Paid Ads" },
            { id: "4", title: "Whatsapp Chatbot" },
            { id: "5", title: "RCS Messages" },
            { id: "6", title: "AI Automation" },
          ],
          businesstype: [
            { "id": "startup", "title": "Startup" },
            { "id": "small_business", "title": "Small Business" },
            { "id": "medium_enterprise", "title": "Medium Enterprise" },
            { "id": "ecommerce_brand", "title": "E-commerce Brand" },
            { "id": "personal_brand", "title": "Personal Brand / Influencer" },
            { "id": "agency", "title": "Digital Marketing Agency" },
            { "id": "local_business", "title": "Local Business / Store" },
            { "id": "ngo", "title": "Non-Profit / NGO" },
            { "id": "manufacturer", "title": "Manufacturer / Distributor" },
            { "id": "freelancer", "title": "Freelancer / Consultant" }
          ],
          country: [
            { id: "India", title: "India" },
            { id: "USA", title: "USA" },
          ],
          state: [],
          is_state_enabled: false,
        },
      };
    }

    /* 2️⃣ data_exchange — dynamic country → state loading */
    else if (action === "data_exchange" && decryptedBody?.data?.country) {
      const selectedCountry = decryptedBody.data.country;
      console.log("🌍 Selected country:", selectedCountry);

      let states = [];
      if (selectedCountry === "India") {
        states = [
          { id: "tamilnadu", title: "Tamil Nadu" },
          { id: "kerala", title: "Kerala" },
          { id: "maharashtra", title: "Maharashtra" },
        ];
      } else if (selectedCountry === "USA") {
        states = [
          { id: "california", title: "California" },
          { id: "texas", title: "Texas" },
        ];
      }

      response = {
        screen: "COUNTRY_SELECTION",
        data: {
          state: states,
          is_state_enabled: true,
        },
      };
    }

    /* 3️⃣ Continue button → move to CONFIRM_SCREEN */
    else if (
      action === "data_exchange" &&
      decryptedBody?.data?.next === "CONFIRM_SCREEN"
    ) {
      console.log("📋 Form submitted:");
      console.log(JSON.stringify(decryptedBody.data.form, null, 2));

      global.lastFormData = decryptedBody.data.form;
      // Optionally save form data here (to DB / JSON file)

      response = {
        screen: "CONFIRM_SCREEN",
        data: {},
      };
    }

    /* 4️⃣ Finish button → flow complete */
    else if (action === "data_exchange" && decryptedBody?.data?.complete) {
      console.log("✅ Flow completion triggered");

      response = {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token: decryptedBody.flow_token || "demo_flow_token",
              status: "completed",
              message: "Lead form successfully submitted",
            },
          },
        },
      };

      try {
        const webhookUrl = "https://webhooksapp.vleafy.com/webhook/691453111b9845c02d4b34bc";

        // ✅ Use the globally stored form data
        const form = global.lastFormData || {};
        console.log(form);

        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: form.name || "",
            email: form.mail || "",
            phone: form.number || "",
            services: form.services || [],
            businesstype: form.chips?.[0] || "",
            country: form.country || "",
            state: form.state || "",
            date: form.date || "",
          }),
        });

        if (!webhookResponse.ok) {
          console.error(
            `❌ Webhook failed: ${webhookResponse.status} ${webhookResponse.statusText}`
          );
        } else {
          console.log("✅ Webhook sent successfully to Vleafy endpoint");
        }
      } catch (err) {
        console.error("❌ Error sending webhook:", err);
      }
    }

    /* 5️⃣ Default fallback */
    else {
      console.warn("⚠️ Unknown or unhandled action received");
      response = {
        screen: "COUNTRY_SELECTION",
        data: {
          "status": "active"
        },
      };
    }
  } catch (err) {
    console.error("❌ Error processing action:", err);
    response = { error: "Internal server error" };
  }

  console.log("👉 Encrypted Response being sent:");
  console.log(JSON.stringify(response, null, 2));
  res.send(encryptResponse(response, aesKeyBuffer, initialVectorBuffer));
});

/* ------------------- ROOT ROUTE ------------------- */
app.get("/", (req, res) => {
  res.send(`<pre>✅ WhatsApp Flow endpoint is running.
POST / to test your flow requests.</pre>`);
});

/* ------------------- SERVER LISTEN ------------------- */
app.listen(PORT, () => {
  console.log(`✅ Flow endpoint running on port ${PORT}`);
});

/* ------------------- SIGNATURE VALIDATION ------------------- */
function isRequestSignatureValid(req) {
  if (!APP_SECRET) {
    console.warn("⚠️ App Secret not set. Add APP_SECRET in .env for signature validation.");
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
    console.error("❌ Error: Request signature mismatch");
    return false;
  }

  return true;
}
