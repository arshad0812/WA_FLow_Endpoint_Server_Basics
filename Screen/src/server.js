  import express from "express";
  import { decryptRequest, encryptResponse, FlowEndpointException } from "./encryption.js";
  import { getNextScreen } from "./flow.js";
  import crypto from "crypto";
  import dotenv from "dotenv";
  import fs from "fs";

  dotenv.config();

  const app = express();

  // JSON parser with raw body capture for signature validation
  app.use(
    express.json({
      verify: (req, res, buf, encoding) => {
        req.rawBody = buf?.toString(encoding || "utf8");
      },
    })
  );

  const { APP_SECRET, PASSPHRASE = "", PORT = "3000" } = process.env;
  const PRIVATE_KEY = fs.readFileSync("private_key_pkcs8.pem", "utf8");
  const VERIFY_TOKEN = "dahsrA*0812"; // Your webhook verify token

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
      switch (action) {
        case "init":
          console.log("⚙️ INIT request received");
          if (decryptedBody.flow_token) {
            console.log("🚀 Starting Flow — showing MY_FIRST_SCREEN");
            response = { screen: "MY_FIRST_SCREEN", data: {} };
          } else {
            console.log("🩺 Health check — returning active");
            response = { data: { status: "active" } };
          }
          break;

        case "ping":
          console.log("📡 Ping received — replying with status active");
          response = { data: { status: "active" } };
          break;

        case "data_exchange":
          console.log("🔄 Data exchange received");

          const dataExchange = decryptedBody?.data.message || {};
          const payload = dataExchange?.payload || {};

          // 👇 Capture message from flow JSON payload
          const message = decryptedBody?.data.message;
          if (message) {
            console.log(`💬 Message from Flow: ${message}`);
          } else {
            console.log("⚠️ No 'message' found in payload");
          }

          // Determine next screen based on the routing model
          const currentScreen = decryptedBody?.screen || "UNKNOWN_SCREEN";
          let nextScreen = "MY_SECOND_SCREEN";

          if (currentScreen === "MY_FIRST_SCREEN") nextScreen = "MY_SECOND_SCREEN";
          else if (currentScreen === "MY_SECOND_SCREEN") nextScreen = "MY_THIRD_SCREEN";
          else if (currentScreen === "MY_THIRD_SCREEN") nextScreen = "THANK_YOU";
          else if (currentScreen === "THANK_YOU") nextScreen = "END";
          // Log which screen comes next
          console.log(`➡️ Moving from ${currentScreen} to ${nextScreen}`);

          if (nextScreen != "END" || nextScreen !== "THANK_YOU") {
            response = {
          screen: nextScreen,
              data: {
                received_message: message,
              },
            };
          }

          break;

        case "complete":
            console.log("📡 Flow Submitted");
            const finalMessage = decryptedBody?.data?.message || "No message found";
            console.log(`💬 Final message from Flow: ${finalMessage}`);
          
            response = {
              action: "complete",
              screen: "THANK_YOU",
              data: {
                final_message: finalMessage,
                text: `Thank you arshad`,
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
