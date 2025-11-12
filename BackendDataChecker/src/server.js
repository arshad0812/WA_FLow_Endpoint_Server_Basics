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
const PRIVATE_KEY = fs.readFileSync("private_key_pkcs8.pem", "utf8");
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

/* ------------------- MOCK USER DATABASE ------------------- */
const usersDB = [
  { name: "arshad", mail: "arshad@gmail.com", phone: "6381794798", city: "Chennai", business: "Startup" },
  { name: "rahul", mail: "rahul@gmail.com", phone: "9876543210", city: "Erode", business: "Small Business" },
];

/* ------------------- MAIN FLOW ENDPOINT ------------------- */
app.post("/", async (req, res) => {
  if (!isRequestSignatureValid(req)) return res.status(432).send();

  let uuser={};
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
    /* 1️⃣ INIT — user opens flow (first screen) */
    if (action === "init") {
      console.log("⚙️ INIT request received");

      response = {
        screen: "SCREEN_ONE", // first screen
        data: {},
      };
    }

    /* 2️⃣ Continue after entering name + mail */
    else if (action === "data_exchange" && decryptedBody?.data?.next === "SCREEN_TWO") {
      const { name, mail } = decryptedBody.data.form;
      console.log(`📩 Checking user: ${name}, ${mail}`);

      // Check if user exists in DB
      const existingUser = usersDB.find(
        (u) =>
          u.name.toLowerCase() === name.toLowerCase() &&
          u.mail.toLowerCase() === mail.toLowerCase()
      );

      uuser=existingUser || {name,mail};

      let initData = {};

      if (existingUser) {
        console.log("✅ Existing user found:", existingUser);
        initData = {
          city: existingUser.city,
          business: existingUser.business,
        };
        response = {
        screen: "SCREEN_TWO",
        data: {
          init_values: {
            name: existingUser.name,
            mail: existingUser.mail,
            city:existingUser.city,
            business:existingUser.business
          }
        },
      };

      } else {
        console.log("🆕 New user — no previous data");
        response = {
        screen: "SCREEN_TWO",
        data: {
          init_values: {
            name: "",
            mail: "",
            city:"",
            business:""
          }
        },
      };

      }

    }

    /* 3️⃣ Continue to confirmation screen */
    else if (action === "data_exchange" && decryptedBody?.data?.next === "CONFIRM_SCREEN") {
      console.log("📋 Form submitted:");
      console.log(JSON.stringify(decryptedBody.data.form, null, 2));

      // Save or update user info here
      const formData = decryptedBody.data.form;
      // const existingIndex = usersDB.findIndex(
      //   (u) =>
      //     u.name.toLowerCase() === uuser.name.toLowerCase() &&
      //     u.mail.toLowerCase() === uuser.mail.toLowerCase()
      // );

      // if (existingIndex >= 0) {
      //   usersDB[existingIndex] = { ...usersDB[existingIndex], ...formData };
      //   console.log("📝 Updated existing user record:", usersDB[existingIndex]);
      // } else {
      //   usersDB.push(formData);
      //   console.log("➕ Added new user record:", formData);
      // }

      response = {
        screen: "CONFIRM_SCREEN",
        data: {},
      };
    }

    /* 4️⃣ Finish button */
    else if (action === "data_exchange" && decryptedBody?.data?.complete) {
      console.log("✅ Flow completed by user.");

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
    }

    /* 5️⃣ Default fallback */
    else {
      console.warn("⚠️ Unknown or unhandled action received");
      response = {
        screen: "SCREEN_ONE",
        data: {
          "status":"active"
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
  res.send(`<pre>✅ WhatsApp Flow endpoint is running.\nPOST / to test your flow requests.</pre>`);
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

/* ------------------- SERVER LISTEN ------------------- */
app.listen(PORT, () => {
  console.log(`✅ Flow endpoint running on port ${PORT}`);
});
