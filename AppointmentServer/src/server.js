/**
 * WhatsApp Flow Endpoint — Vleafy Appointment Booking
 * Author: Arshad
 * Version: 2.0
 */

import express from "express";
import { decryptRequest, encryptResponse, FlowEndpointException } from "./encryption.js";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();

/* ------------------- EXPRESS CONFIG ------------------- */
app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf?.toString(encoding || "utf8");
    },
  })
);

/* ------------------- ENV VARIABLES ------------------- */
const { APP_SECRET, PASSPHRASE = "", PORT = "3000" } = process.env;
const PRIVATE_KEY = fs.readFileSync("private_key_pkcs8.pem", "utf8");
const VERIFY_TOKEN = "dahsrA*0812";
const WEBHOOK_URL = "https://webhooksapp.vleafy.com/webhook/679cafd2746dcfd84f580cb2";

global.lastFormData = {};

/* ------------------- VERIFY WEBHOOK ------------------- */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    return res.status(200).send(challenge);
  }

  console.log("❌ Webhook verification failed");
  res.sendStatus(403);
});

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

  let response = {};

  try {
    /* 1️⃣ INIT — user opens the flow */
    if (action === "init") {
      console.log("⚙️ INIT request received");

      response = {
        screen: "APPOINTMENT_FORM",
        data: {
          departments: [
            { id: "cardiology", title: "Cardiology" },
            { id: "dermatology", title: "Dermatology" },
            { id: "neurology", title: "Neurology" },
            { id: "orthopedics", title: "Orthopedics" },
          ],
          doctors: [
            { id: "dr_smith", title: "Dr. Smith" },
            { id: "dr_john", title: "Dr. John" },
            { id: "dr_clara", title: "Dr. Clara" },
            { id: "dr_rohit", title: "Dr. Rohit" },
          ],
          businesstype: [
            { id: "startup", title: "Startup" },
            { id: "small_business", title: "Small Business" },
            { id: "medium_enterprise", title: "Medium Enterprise" },
            { id: "ecommerce_brand", title: "E-commerce Brand" },
            { id: "personal_brand", title: "Personal Brand / Influencer" },
            { id: "agency", title: "Digital Marketing Agency" },
            { id: "local_business", title: "Local Business / Store" },
            { id: "ngo", title: "Non-Profit / NGO" },
            { id: "manufacturer", title: "Manufacturer / Distributor" },
            { id: "freelancer", title: "Freelancer / Consultant" },
          ],
          is_doctor_enabled: false,
        },
      };
    }

    /* 2️⃣ Department Selection → Enable Doctor Dropdown */
    else if (action === "data_exchange" && decryptedBody?.data?.department) {
      const department = decryptedBody.data.department;
      console.log("🏥 Department selected:", department);

      // In a real project, you could filter doctors by department here
      const doctorList = [
        { id: "dr_smith", title: "Dr. Smith" },
        { id: "dr_john", title: "Dr. John" },
        { id: "dr_clara", title: "Dr. Clara" },
        { id: "dr_rohit", title: "Dr. Rohit" },
      ];

      response = {
        screen: "APPOINTMENT_FORM",
        data: {
          doctors: doctorList,
          is_doctor_enabled: true,
        },
      };
    }

    /* 3️⃣ Continue → Confirm Screen */
    else if (
      action === "data_exchange" &&
      decryptedBody?.data?.next === "CONFIRM_SCREEN"
    ) {
      console.log("📋 Appointment Form Submitted:");
      console.log(JSON.stringify(decryptedBody.data.form, null, 2));

      global.lastFormData = decryptedBody.data.form;

      response = {
        screen: "CONFIRM_SCREEN",
        data: {},
      };
    }

    /* 4️⃣ Finish → Flow Complete */
    else if (action === "data_exchange" && decryptedBody?.data?.complete) {
      console.log("✅ Flow completion triggered");

      response = {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token: decryptedBody.flow_token || "demo_token",
              status: "completed",
              message: "Appointment successfully booked",
            },
          },
        },
      };

      try {
        const form = global.lastFormData || {};
        console.log("📦 Sending appointment details to webhook:", form);

        const webhookResponse = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name || "",
            phone: form.number || "",
            age: form.age || "",
            gender: form.gender || "",
            department: form.department || "",
            doctor: form.doctor || "",
            appointmentdate: form.appointmentdate || "",
            time: form.time?.[0] || "",
            symptoms: form.symptoms || "",
            consultation_mode: form.consultationmode?.[0] || "",
            status: "completed",
          }),
        });

        if (!webhookResponse.ok) {
          console.error(
            `❌ Webhook failed: ${webhookResponse.status} ${webhookResponse.statusText}`
          );
        } else {
          console.log("✅ Appointment data sent successfully to webhook endpoint");
        }
      } catch (err) {
        console.error("❌ Error sending webhook:", err);
      }
    }

    /* 5️⃣ Fallback for Unknown Actions */
    else {
      console.warn("⚠️ Unknown or unhandled action received");
      response = {
        screen: "APPOINTMENT_FORM",
        data: {
          status: "active",
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
  res.send(`<pre>✅ WhatsApp Appointment Flow endpoint is running.
POST / to test flow actions.</pre>`);
});

/* ------------------- SIGNATURE VALIDATION ------------------- */
function isRequestSignatureValid(req) {
  if (!APP_SECRET) {
    console.warn("⚠️ APP_SECRET not set — skipping signature validation (dev mode).");
    return true;
  }

  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader) {
    console.error("❌ Missing signature header");
    return false;
  }

  const signature = signatureHeader.replace("sha256=", "");
  const hmac = crypto.createHmac("sha256", APP_SECRET);
  const digest = hmac.update(req.rawBody).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
    console.error("❌ Signature mismatch");
    return false;
  }

  return true;
}

/* ------------------- SERVER LISTEN ------------------- */
app.listen(PORT, () => {
  console.log(`✅ Appointment Flow endpoint running on port ${PORT}`);
});
